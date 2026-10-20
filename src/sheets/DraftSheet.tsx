import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ArrowsClockwiseIcon, BellSimpleIcon, CopyIcon, NewspaperIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { AstraThinking, SourceBadge } from '@/components/astra/Astra'
import { PrimaryButton, Segmented } from '@/components/ui'
import { CHANNEL_ACTION } from '@/components/icons'
import { astraDrafts, astraNews, type Result } from '@/ai/astra'
import type { Drafts } from '@/ai/schemas'
import { OCCASION_META, type Occasion } from '@/ai/local/occasions'
import { useAstraStatus, useOccasions } from '@/ai/hooks'
import { usePerson } from '@/data/hooks'
import { addReminder, logInteraction } from '@/data/actions'
import { DAY, startOfDay } from '@/lib/format'
import { openChannel, primaryChannel } from '@/lib/contact'
import { haptic, useUI } from '@/app/store'
import { t } from '@/i18n'

type Tone = keyof Drafts
const TONES: { value: Tone; label: string }[] = [
  { value: 'short', get label() { return t('Short') } },
  { value: 'warm', get label() { return t('Warm') } },
  { value: 'business', get label() { return t('To the point') } },
]

/** A reason → a draft in three tones → sending in one tap. */
export function DraftSheet({ personId, occasion: given, onClose }: { personId: string; occasion?: Occasion | null; onClose: () => void }) {
  const p = usePerson(personId)
  const { byPerson } = useOccasions()
  const status = useAstraStatus()
  const toast = useUI(s => s.toast)
  const [occasion, setOccasion] = useState<Occasion | null>(given ?? byPerson.get(personId) ?? null)
  const [res, setRes] = useState<Result<Drafts> | null>(null)
  const [tone, setTone] = useState<Tone>('warm')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [newsLoading, setNewsLoading] = useState(false)

  const load = async (o: Occasion | null, force = false) => {
    setLoading(true)
    try {
      const r = await astraDrafts(personId, o, force)
      setRes(r)
      setText(r.data[tone])
    } finally { setLoading(false) }
  }
  useEffect(() => { load(occasion) }, [personId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (res) setText(res.data[tone]) }, [tone]) // eslint-disable-line react-hooks/exhaustive-deps

  const ch = p ? primaryChannel(p) : undefined
  const meta = occasion ? OCCASION_META[occasion.kind] : null

  const copy = async () => {
    try { await navigator.clipboard.writeText(text) } catch { /* noop */ }
  }
  const send = async () => {
    if (!p) return
    await copy()
    haptic(12)
    if (ch) {
      openChannel(ch)
      setTimeout(() => toast(t('Text copied — paste it into the chat'), 'info', {
        label: t('Sent'),
        run: async () => { await logInteraction({ personIds: [p.id], type: ch.type === 'phone' ? 'call' : 'message', date: Date.now(), title: meta ? t('{label}: message', { label: meta.label }) : t('Message'), note: text }); toast(t('Contact logged')) },
      }), 350)
    } else {
      toast(t('Copied — this person has no contacts, add them on the card'), 'info')
    }
    onClose()
  }

  const findNews = async () => {
    setNewsLoading(true)
    const news = await astraNews(personId)
    setNewsLoading(false)
    if (!news) { toast(t('No fresh news found'), 'info'); return }
    const o: Occasion = { id: `news-${personId}`, personId, kind: 'news', title: t('News'), detail: news, priority: 70, data: { news } }
    setOccasion(o)
    load(o, true)
  }

  return (
    <Sheet onClose={onClose} tall glow={meta ? `color-mix(in srgb, ${meta.color} 28%, transparent)` : undefined}
      title={p ? <span className="flex items-center gap-3"><Avatar person={p} size={36} /> {p.firstName}</span> : t('Message')}
      subtitle={occasion ? `${meta?.emoji} ${occasion.title} · ${occasion.detail}` : t('No special occasion — just a nudge to stay in touch')}
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={async () => { await copy(); toast(t('Copied')) }} className="press btn-glass h-[52px] w-[52px] !px-0" aria-label={t('Copy')}><CopyIcon size={19} /></button>
          <PrimaryButton className="flex-1" disabled={!text.trim()} onClick={send}>
            <PaperPlaneTiltIcon size={17} weight="bold" /> {ch ? CHANNEL_ACTION[ch.type] : t('Copy text')}
          </PrimaryButton>
        </div>
      }>
      {loading || !res ? (
        <AstraThinking kind="drafts" className="pt-14" />
      ) : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-3 flex items-center justify-between">
            <SourceBadge source={res.source} error={res.error} />
            <div className="flex items-center gap-3">
              {status.webSearch && (
                <button type="button" disabled={newsLoading} onClick={findNews} className="press flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-fg disabled:opacity-50">
                  <NewspaperIcon size={14} /> {newsLoading ? t('Searching…') : t('Find news')}
                </button>
              )}
              {status.connected && <button type="button" onClick={() => load(occasion, true)} className="press flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-fg"><ArrowsClockwiseIcon size={14} />{' '}{t('Other options')}</button>}
            </div>
          </div>
          {occasion?.kind === 'birthday' && Number(occasion.data.days) > 0 && (
            <button type="button" onClick={async () => {
              await addReminder({ personId, text: t('Birthday: {v} — congratulate', { v: p?.firstName ?? '' }), dueAt: startOfDay() + Number(occasion.data.days) * DAY + 10 * 3600_000 })
              toast(t("I'll remind you on the birthday at 10:00"), 'bell')
            }} className="press glass mb-3 flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left">
              <BellSimpleIcon size={18} className="text-[#ff8fb8]" />
              <span className="min-w-0 flex-1 text-[14px]">{t('Better to congratulate on the day itself —')}{' '}<span className="font-semibold">{t('remind')}{' '}{Number(occasion.data.days) === 1 ? t('tomorrow') : t('in {days} days', { days: occasion.data.days })}</span></span>
            </button>
          )}
          <Segmented value={tone} onChange={setTone} options={TONES} />
          <div className="glass mt-3 rounded-[24px] p-4">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.max(5, Math.ceil(text.length / 38))} className="field resize-none text-[17px] leading-relaxed" />
          </div>
          <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-fg-4">{t("Edit freely — it's a draft. Astra never sends anything itself: the text is copied and the chat opens on your side.")}</p>
        </motion.div>
      )}
    </Sheet>
  )
}
