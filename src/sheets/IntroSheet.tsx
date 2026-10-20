import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon, PaperPlaneTiltIcon, XIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { AstraThinking, SourceBadge } from '@/components/astra/Astra'
import { Segmented } from '@/components/ui'
import { astraIntroDrafts, setIntroStatus, type Result } from '@/ai/astra'
import type { IntroDrafts } from '@/ai/schemas'
import { usePerson } from '@/data/hooks'
import { fullName, jobLine } from '@/lib/format'
import { openChannel, primaryChannel } from '@/lib/contact'
import { haptic, useUI } from '@/app/store'
import type { Person } from '@/data/types'
import { t } from '@/i18n'

type Tab = 'to_a' | 'to_b' | 'group'

/** An introduction by double opt-in: first to each person privately, then a shared chat. */
export function IntroSheet({ aId, bId, reason, value, onClose }: { aId: string; bId: string; reason: string; value: string; onClose: () => void }) {
  const a = usePerson(aId)
  const b = usePerson(bId)
  const toast = useUI(s => s.toast)
  const [res, setRes] = useState<Result<IntroDrafts> | null>(null)
  const [tab, setTab] = useState<Tab>('to_a')
  const [texts, setTexts] = useState<IntroDrafts | null>(null)

  useEffect(() => {
    if (!a || !b || res) return
    astraIntroDrafts({ a, b, reason, value, score: 0 }).then(r => { setRes(r); setTexts(r.data) })
  }, [a, b]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!a || !b) return <Sheet onClose={onClose} title={t('Introduction')}><div className="h-40" /></Sheet>

  const target: Person | null = tab === 'to_a' ? a : tab === 'to_b' ? b : null
  const ch = target ? primaryChannel(target) : undefined
  const text = texts?.[tab] ?? ''

  const sendTo = async () => {
    try { await navigator.clipboard.writeText(text) } catch { /* noop */ }
    haptic(10)
    if (ch) openChannel(ch)
    toast(ch ? t('Text copied — paste it into the chat') : t('Text copied'))
    if (tab !== 'group') await setIntroStatus({ a, b, reason }, 'asked')
  }
  const mark = async (status: 'done' | 'dismissed') => {
    await setIntroStatus({ a, b, reason }, status)
    haptic(20)
    toast(status === 'done' ? t('Done: {firstName} and {firstName2} are introduced ✦', { firstName: a.firstName, firstName2: b.firstName }) : t('Pair hidden'), status === 'done' ? 'check' : 'info')
    onClose()
  }

  return (
    <Sheet onClose={onClose} tall title={t('Introduce')} subtitle={t('Ask each person privately first — then start a group chat')} glow="rgb(127 214 255 / 0.25)"
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={() => mark('dismissed')} className="press btn-glass h-[52px] w-[52px] shrink-0 !px-0" aria-label={t('Not a fit')}><XIcon size={18} /></button>
          <button type="button" onClick={() => mark('done')} className="press btn-glass h-[52px] flex-1"><CheckIcon size={17} weight="bold" />{' '}{t('Introduced')}</button>
          <button type="button" onClick={sendTo} disabled={!text} className="press btn-primary h-[52px] flex-[1.3]">
            {ch ? <PaperPlaneTiltIcon size={17} weight="bold" /> : <CopyIcon size={17} />} {tab === 'group' || !ch ? t('Copy') : t('Send')}
          </button>
        </div>
      }>
      <PairHero a={a} b={b} />
      <p className="mt-4 text-center text-[16px] leading-relaxed">{reason}</p>
      <p className="mt-1.5 text-center text-[13.5px] text-fg-3">{value}</p>

      {!res || !texts ? <AstraThinking kind="drafts" className="pt-8" /> : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
          <div className="mb-3 flex justify-between"><span className="micro text-fg-3">{t('Messages')}</span><SourceBadge source={res.source} error={res.error} /></div>
          <Segmented value={tab} onChange={setTab} options={[{ value: 'to_a', label: a.firstName }, { value: 'to_b', label: b.firstName }, { value: 'group', label: t('Group chat') }]} />
          <div className="glass mt-3 rounded-[24px] p-4">
            <textarea value={text} onChange={e => setTexts(item => (item ? { ...item, [tab]: e.target.value } : item))} rows={6} className="field resize-none text-[16px] leading-relaxed" />
          </div>
          <ol className="mt-4 space-y-2 px-1 text-[13px] text-fg-3">
            <li><b className="text-fg-2">1.</b>{' '}{t('Write to')}{' '}{a.firstName}{' '}{t('and')}{' '}{b.firstName}{' '}{t('separately — ask for consent.')}</li>
            <li><b className="text-fg-2">2.</b>{' '}{t('When both are in, create a group chat and paste the third message.')}</li>
            <li><b className="text-fg-2">3.</b>{' '}{t('Tap “Introduced” — Astra will remember the connection and your help to both.')}</li>
          </ol>
        </motion.div>
      )}
    </Sheet>
  )
}

/** Two stars joined by a glowing line. */
export function PairHero({ a, b, size = 64 }: { a: Person; b: Person; size?: number }) {
  return (
    <div className="relative mx-auto flex max-w-[340px] items-center justify-between px-2 pt-2">
      <div className="z-10 flex w-[110px] flex-col items-center text-center">
        <Avatar person={a} size={size} />
        <div className="mt-2 truncate text-[14.5px] font-semibold">{fullName(a)}</div>
        <div className="truncate text-[12px] text-fg-3">{jobLine(a)}</div>
      </div>
      <div className="absolute left-[95px] right-[95px] top-[calc(8px+32px)] h-px">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgb(255 217 168 / 0.1), rgb(255 217 168 / 0.9), rgb(167 150 255 / 0.9), rgb(167 150 255 / 0.1))', boxShadow: '0 0 12px rgb(255 200 150 / 0.6)' }} />
        <motion.span className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_3px_rgba(255,220,180,0.8)]"
          initial={{ left: '0%' }} animate={{ left: ['0%', '100%', '0%'] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }} />
      </div>
      <div className="z-10 flex w-[110px] flex-col items-center text-center">
        <Avatar person={b} size={size} />
        <div className="mt-2 truncate text-[14.5px] font-semibold">{fullName(b)}</div>
        <div className="truncate text-[12px] text-fg-3">{jobLine(b)}</div>
      </div>
    </div>
  )
}
