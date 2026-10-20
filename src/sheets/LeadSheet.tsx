import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, ArrowsClockwiseIcon, BellSimpleIcon, ChatCircleDotsIcon, CopyIcon, PaperPlaneTiltIcon, PencilSimpleIcon, StarIcon, TrashIcon, UserPlusIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { AstraStar, AstraThinking, SourceBadge } from '@/components/astra/Astra'
import { TagPill } from '@/components/reserve/parts'
import { ActionButton, Group, PrimaryButton, Row, Segmented } from '@/components/ui'
import { CHANNELS, CHANNEL_ACTION } from '@/components/icons'
import { astraLeadDrafts, type Result } from '@/ai/astra'
import { reserveMatches } from '@/ai/local/reserve'
import type { Drafts } from '@/ai/schemas'
import { useAstraStatus } from '@/ai/hooks'
import { logInteraction } from '@/data/actions'
import { deleteLeads, patchLeads, promoteLead } from '@/data/leads'
import { useCircles, useLead, usePeople } from '@/data/hooks'
import { CLOSENESS } from '@/data/logic'
import { dateLong, fullName, jobLine } from '@/lib/format'
import { openChannel, primaryChannel } from '@/lib/contact'
import { PALETTES } from '@/lib/colors'
import { Chip } from '@/components/ui'
import { haptic, useUI } from '@/app/store'
import type { Closeness } from '@/data/types'
import { t } from '@/i18n'

function AutoText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} rows={4} className="field resize-none overflow-hidden text-[17px] leading-relaxed" />
}

type Tone = keyof Drafts
const TONES: { value: Tone; label: string }[] = [
  { value: 'short', get label() { return t('Short') } },
  { value: 'warm', get label() { return t('Warm') } },
  { value: 'business', get label() { return t('To the point') } },
]

export function LeadSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const lead = useLead(id)
  const people = usePeople()
  const circles = useCircles()
  const status = useAstraStatus()
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const nav = useNavigate()
  const [mode, setMode] = useState<'card' | 'write' | 'promote'>('card')
  const [confirmDel, setConfirmDel] = useState(false)
  // "what to write"
  const [res, setRes] = useState<Result<Drafts> | null>(null)
  const [tone, setTone] = useState<Tone>('warm')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  // "to the network"
  const [closeness, setCloseness] = useState<Closeness>(3)
  const [circleIds, setCircleIds] = useState<string[]>([])

  const useful = useMemo(() => (lead ? reserveMatches(people ?? [], [lead], 2) : []), [lead, people])

  const load = async (force = false) => {
    setLoading(true)
    try {
      const r = await astraLeadDrafts(id, force)
      setRes(r)
      setText(r.data[tone])
    } finally { setLoading(false) }
  }
  useEffect(() => { if (mode === 'write' && !res) load() }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (res) setText(res.data[tone]) }, [tone]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lead) return null
  const ch = primaryChannel(lead)
  const name = fullName(lead)

  const copy = async (value2: string) => { try { await navigator.clipboard.writeText(value2); return true } catch { return false } }

  const toNetwork = async (note?: string) => {
    const pid = await promoteLead(lead.id, { closeness, circleIds })
    if (!pid) return
    if (note) await logInteraction({ personIds: [pid], type: ch?.type === 'phone' ? 'call' : 'message', date: Date.now(), title: t('First message'), note })
    return pid
  }

  const send = async () => {
    await copy(text)
    haptic(12)
    if (ch) {
      openChannel(ch)
      setTimeout(() => toast(t('Text copied — paste it into the chat'), 'info', {
        label: t('Sent'),
        run: async () => { const pid = await toNetwork(text); if (pid) toast(t('{firstName} is now in your network — a separate card under “People”', { firstName: lead.firstName })) },
      }), 350)
    } else toast(t('Copied — this contact has no channels, add them on the card'), 'info')
    onClose()
  }

  const footer = mode === 'write' ? (
    <div className="flex gap-2">
      <button type="button" onClick={async () => { await copy(text); toast(t('Copied')) }} className="press btn-glass h-[52px] w-[52px] !px-0" aria-label={t('Copy')}><CopyIcon size={19} /></button>
      <PrimaryButton className="flex-1" disabled={!text.trim()} onClick={send}><PaperPlaneTiltIcon size={17} weight="bold" /> {ch ? CHANNEL_ACTION[ch.type] : t('Copy text')}</PrimaryButton>
    </div>
  ) : mode === 'promote' ? (
    <PrimaryButton className="w-full" onClick={async () => { const pid = await toNetwork(); if (pid) { onClose(); nav(`/person/${pid}`); toast(t('{firstName} is now in your network', { firstName: lead.firstName })) } }}>
      <UserPlusIcon size={18} weight="bold" />{' '}{t('Move to network')}
    </PrimaryButton>
  ) : (
    <div className="flex gap-2">
      <button type="button" onClick={() => open({ kind: 'leadEdit', id })} className="press btn-glass h-[52px] shrink-0 px-5 text-[15px]"><PencilSimpleIcon size={17} />{' '}{t('Edit')}</button>
      <PrimaryButton className="flex-1" onClick={() => setMode('write')}><AstraStar size={16} />{' '}{t('What to write')}</PrimaryButton>
    </div>
  )

  return (
    <Sheet onClose={onClose} tall glow={lead.star ? 'rgb(255 210 122 / 0.26)' : 'rgb(95 227 176 / 0.22)'} footer={footer}
      title={<span className="flex items-center gap-3">{mode !== 'card' && <button type="button" aria-label={t('Back')} onClick={() => setMode('card')} className="press -ml-1 grid h-8 w-8 place-items-center rounded-full bg-white/[0.08]"><ArrowLeftIcon size={16} /></button>}<Avatar person={lead} size={40} /><span className="truncate">{name}</span></span>}
      subtitle={mode === 'write' ? t('First message · formal tone') : mode === 'promote' ? t('Becomes a regular card in your network') : jobLine(lead) || lead.city}>

      {mode === 'card' && (
        <>
          {lead.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{lead.tags.map(tag2 => <TagPill key={tag2} tag={tag2} />)}</div>}

          <div className="mt-5 flex justify-between gap-1">
            <ActionButton icon={ChatCircleDotsIcon} label={ch ? CHANNELS[ch.type].label.slice(0, 9) : t('Write')} primary onClick={() => (ch ? openChannel(ch) : toast(t('Add a contact on the card'), 'info'))} />
            <ActionButton icon={BellSimpleIcon} label={t('Remind')} onClick={() => open({ kind: 'reminder', text: t('Write: {firstName}', { firstName: lead.firstName }) })} />
            <ActionButton icon={StarIcon} label={t('Strong')} active={lead.star} onClick={() => patchLeads([lead.id], l => ({ star: !l.star }))} />
            <ActionButton icon={UserPlusIcon} label={t('To network')} onClick={() => setMode('promote')} />
          </div>

          {useful.length > 0 && (
            <div className="mt-5 space-y-2">
              {useful.map(m => (
                <div key={m.person.id} className="glass flex items-start gap-3 rounded-[20px] p-3.5" style={{ background: 'linear-gradient(135deg, rgb(255 217 168 / 0.1), rgb(167 150 255 / 0.1))' }}>
                  <AstraStar size={18} className="mt-0.5" />
                  <p className="text-[14px] leading-snug text-fg-2"><b className="text-fg">{m.person.firstName}</b>{' '}{t('is looking for “')}{m.person.lookingFor}{t('” — this contact fits. You could offer an introduction.')}</p>
                </div>
              ))}
            </div>
          )}

          <div className="glass mt-5 rounded-[24px] p-5">
            <div className="micro mb-2 text-fg-3">{t('Why they matter')}</div>
            {lead.why ? <p className="text-[17px] leading-relaxed">{lead.why}</p> : (
              <button type="button" onClick={() => open({ kind: 'leadEdit', id })} className="press text-left text-[15px] text-fg-3">{t('Nothing written — add a few words so you can find them later')}</button>
            )}
            <div className="mt-3 text-[12.5px] text-fg-3">
              {lead.source ? <>{t('From:')}{' '}<span className="text-fg-2">{lead.source}</span> · </> : null}{t('added')}{' '}{dateLong(lead.createdAt)}
            </div>
          </div>

          {lead.channels.length > 0 && (
            <Group title={t('Contacts')} className="mt-5">
              {lead.channels.map((c, i) => {
                const m = CHANNELS[c.type]
                return (
                  <div key={i} className="flex items-center">
                    <button type="button" onClick={() => openChannel(c)} className="press flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3.5 text-left hover:bg-white/[0.025]">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]"><m.icon size={18} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15.5px] leading-snug">{c.value}</span>
                        <span className="block text-[13px] leading-snug text-fg-3">{m.label}</span>
                      </span>
                    </button>
                    <button type="button" aria-label={t('Copy')} onClick={async () => { await copy(c.value); toast(t('Copied')) }} className="press mr-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg-3 hover:text-fg"><CopyIcon size={17} /></button>
                  </div>
                )
              })}
            </Group>
          )}

          {(lead.city || lead.notes) && (
            <Group title={t('More')} className="mt-5">
              {lead.city && <Row label={lead.city} sub={t('City')} />}
              {lead.notes && <Row label={<span className="whitespace-pre-wrap">{lead.notes}</span>} sub={t('Note')} />}
            </Group>
          )}

          <div className="mt-6 flex justify-center">
            {!confirmDel ? (
              <button type="button" onClick={() => setConfirmDel(true)} className="press flex items-center gap-1.5 text-[13.5px] text-fg-3 hover:text-danger"><TrashIcon size={15} />{' '}{t('Delete from reserve')}</button>
            ) : (
              <button type="button" onClick={async () => { await deleteLeads([lead.id]); onClose(); toast(t('Deleted'), 'info') }} className="press flex items-center gap-1.5 text-[14px] font-semibold text-danger"><TrashIcon size={15} />{' '}{t('Really delete? Tap again')}</button>
            )}
          </div>
        </>
      )}

      {mode === 'write' && (
        loading || !res ? <AstraThinking kind="lead" className="pt-14" /> : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mb-3 flex items-center justify-between">
              <SourceBadge source={res.source} error={res.error} />
              {status.connected && <button type="button" onClick={() => load(true)} className="press flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-fg"><ArrowsClockwiseIcon size={14} />{' '}{t('Other options')}</button>}
            </div>
            <Segmented value={tone} onChange={setTone} options={TONES} />
            <div className="glass mt-3 rounded-[24px] p-4">
              <AutoText value={text} onChange={setText} />
            </div>
            <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-fg-4">{t('A first touch — ask for little and keep it to the point. When you tap “Sent”,')}{' '}{lead.firstName}{' '}{t('moves from the reserve to your network and the message is logged in the history. Astra never sends anything on its own.')}</p>
          </motion.div>
        )
      )}

      {mode === 'promote' && (
        <div className="pt-2">
          <p className="text-[14.5px] leading-relaxed text-fg-2">{t('When a relationship begins, the card belongs in the network: rhythm, reminders, the timeline and “Orbit” work there.')}</p>
          <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Orbit')}</div>
          <Segmented<Closeness> value={closeness} onChange={setCloseness} options={([1, 2, 3, 4] as Closeness[]).map(c => ({ value: c, label: CLOSENESS[c].short }))} />
          <div className="mt-1.5 px-2 text-[12px] text-fg-4">{t('Default rhythm: every')}{' '}{CLOSENESS[closeness].cadence}{' '}{t('days')}</div>
          {circles.length > 0 && (
            <>
              <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Circles (optional)')}</div>
              <div className="flex flex-wrap gap-1.5">
                {circles.map(c => (
                  <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={circleIds.includes(c.id)} onClick={() => setCircleIds(ids => (ids.includes(c.id) ? ids.filter(x => x !== c.id) : [...ids, c.id]))}>{c.emoji} {c.name}</Chip>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="h-4" />
    </Sheet>
  )
}
