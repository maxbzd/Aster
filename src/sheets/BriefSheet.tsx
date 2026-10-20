import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowsClockwiseIcon, ChatTeardropTextIcon, CheckCircleIcon, ClockCounterClockwiseIcon, HandHeartIcon, PaperPlaneTiltIcon, SealWarningIcon, SparkleIcon, UserIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { AstraThinking, SourceBadge } from '@/components/astra/Astra'
import { PrimaryButton } from '@/components/ui'
import { astraBrief, type Result } from '@/ai/astra'
import type { Brief } from '@/ai/schemas'
import { usePerson } from '@/data/hooks'
import { personGradient } from '@/lib/colors'
import { fullName, jobLine } from '@/lib/format'
import { useAstraStatus } from '@/ai/hooks'
import { useUI } from '@/app/store'
import { t } from '@/i18n'

/** Бриф перед встречей — читается за 30 секунд. */
export function BriefSheet({ personId, onClose }: { personId: string; onClose: () => void }) {
  const p = usePerson(personId)
  const status = useAstraStatus()
  const open = useUI(s => s.open)
  const [res, setRes] = useState<Result<Brief> | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async (force = false) => {
    setLoading(true)
    try { setRes(await astraBrief(personId, force)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [personId]) // eslint-disable-line react-hooks/exhaustive-deps

  const g = personGradient(personId)
  const b = res?.data

  return (
    <Sheet onClose={onClose} tall glow={`${g.a}55`}
      title={p ? <span className="flex items-center gap-3"><Avatar person={p} size={36} />{' '}{t('Brief:')}{' '}{p.firstName}</span> : t('Brief')}
      subtitle={p ? jobLine(p) || undefined : undefined}
      footer={p && (
        <div className="flex gap-2">
          <button type="button" onClick={() => open({ kind: 'log', personIds: [personId], type: 'meeting' })} className="press btn-glass h-[52px] flex-1">{t('Log')}</button>
          <PrimaryButton className="flex-1" onClick={() => open({ kind: 'draft', personId })}><PaperPlaneTiltIcon size={17} weight="bold" />{' '}{t('Write')}</PrimaryButton>
        </div>
      )}>
      {loading || !b ? (
        <AstraThinking kind="brief" className="pt-16" />
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-3 flex items-center justify-between">
            <SourceBadge source={res!.source} error={res!.error} />
            {status.connected && <button type="button" onClick={() => load(true)} className="press flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-fg"><ArrowsClockwiseIcon size={14} />{' '}{t('Refresh')}</button>}
          </div>
          <p className="display text-[26px] leading-[1.18]">{b.headline}</p>

          {/* С чего начать — карточка под лампой */}
          <div className="glass relative mt-5 overflow-hidden rounded-[24px] px-5 pb-5 pt-9">
            <div aria-hidden className="absolute left-1/2 top-0 -translate-x-1/2">
              <div className="mx-auto h-3 w-px bg-white/25" />
              <div className="mx-auto h-[8px] w-[26px] rounded-b-full bg-gradient-to-b from-[#3a3a46] to-[#1c1c24]" />
              <div className="mx-auto -mt-[2px] h-[5px] w-[10px] rounded-full bg-[#fff1d6] shadow-[0_0_14px_5px_rgba(255,214,150,0.7)]" />
            </div>
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-[18px] h-[200px] w-[300px] -translate-x-1/2" style={{ background: 'radial-gradient(50% 70% at 50% 0%, rgba(255,214,150,0.22), transparent 75%)', clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0 100%)' }} />
            <div className="micro relative text-center text-[#ffe2c2]">{t('Where to start')}</div>
            <p className="relative mt-2 text-center text-[16px] leading-relaxed">{b.opener}</p>
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            <Block icon={UserIcon} color="#a796ff" title={t('Who this is')}><p>{b.who}</p></Block>
            <Block icon={ClockCounterClockwiseIcon} color="#7fd6ff" title={t('Last time')}><p>{b.last_time}</p></Block>
            {b.ask_about.length > 0 && (
              <Block icon={ChatTeardropTextIcon} color="#ffd27a" title={t('What to ask about')}>
                <ol className="space-y-1.5">{b.ask_about.map((q, i) => <li key={i} className="flex gap-2.5"><span className="tnum text-fg-4">{i + 1}</span><span>{q}</span></li>)}</ol>
              </Block>
            )}
            {(b.promises_mine.length > 0 || b.promises_theirs.length > 0) && (
              <Block icon={CheckCircleIcon} color="#ffb36b" title={t('Promises')}>
                {b.promises_mine.map((x, i) => <div key={`m${i}`} className="flex gap-2"><span className="text-fg-4">{t('you:')}</span>{x}</div>)}
                {b.promises_theirs.map((x, i) => <div key={`t${i}`} className="flex gap-2"><span className="text-fg-4">{t('to you:')}</span>{x}</div>)}
              </Block>
            )}
            {b.details.length > 0 && (
              <Block icon={SparkleIcon} color="#ff8fb8" title={t('Details worth remembering')}>
                <div className="flex flex-wrap gap-1.5">{b.details.map((d, i) => <span key={i} className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[13.5px]">{d}</span>)}</div>
              </Block>
            )}
            {b.you_can_help.length > 0 && (
              <Block icon={HandHeartIcon} color="#5fe3b0" title={t('How you can help')}>
                <ul className="space-y-1.5">{b.you_can_help.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </Block>
            )}
            {b.careful.length > 0 && (
              <Block icon={SealWarningIcon} color="#ff8f8f" title={t('Handle with care')}>
                <ul className="space-y-1.5">{b.careful.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </Block>
            )}
          </div>
          {p && <p className="mt-5 text-center text-[12px] text-fg-4">{t('The brief is built from the card')}{' '}{fullName(p)}{' '}{t('and your history')}</p>}
        </motion.div>
      )}
    </Sheet>
  )
}

function Block({ icon: I, color, title, children }: { icon: typeof UserIcon; color: string; title: string; children: ReactNode }) {
  return (
    <div className="glass rounded-[22px] p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold" style={{ color }}><I size={16} weight="duotone" />{title}</div>
      <div className="text-[15px] leading-relaxed text-fg">{children}</div>
    </div>
  )
}
