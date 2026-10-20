import { AnimatePresence, motion, useMotionValue, useTransform, animate, type PanInfo } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { BellSimpleIcon, CheckIcon, ClockCountdownIcon, PaperPlaneTiltIcon, SparkleIcon, XIcon } from '@phosphor-icons/react'
import { Avatar } from '@/components/Avatar'
import { Aurora } from '@/components/Aurora'
import { Orb } from '@/components/Orb'
import { CHANNEL_ACTION } from '@/components/icons'
import { primaryChannel } from '@/lib/contact'
import { usePeople } from '@/data/hooks'
import { cadenceLabel, contactAnchor, dueContacts, warmthOf, WARMTH_LABEL } from '@/data/logic'
import { addReminder, logInteraction, snooze } from '@/data/actions'
import { personGradient, WARMTH_COLORS } from '@/lib/colors'
import { ago, DAY, fullName, jobLine, startOfDay } from '@/lib/format'
import { useReachOut } from '@/app/reach'
import { haptic, useUI } from '@/app/store'
import type { Person } from '@/data/types'
import { t } from '@/i18n'

type Verdict = 'done' | 'later' | 'remind'

export function Review() {
  const people = usePeople()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [queue, setQueue] = useState<Person[] | null>(null)
  const [index, setIndex] = useState(0)
  const [stats, setStats] = useState({ done: 0, later: 0, remind: 0 })

  useEffect(() => {
    if (people && queue === null) setQueue(dueContacts(people).map(x => x.p))
  }, [people, queue])

  const current = queue?.[index]
  const g = current ? personGradient(current.id) : null

  const decide = async (v: Verdict) => {
    if (!current) return
    haptic(15)
    setIndex(i => i + 1)
    setStats(s => ({ ...s, [v]: s[v] + 1 }))
    if (v === 'done') await logInteraction({ personIds: [current.id], type: 'message', date: Date.now() })
    if (v === 'later') await snooze(current.id, 7)
    if (v === 'remind') {
      await addReminder({ personId: current.id, text: t("Reach out — haven't been in touch for a while"), dueAt: startOfDay() + DAY + 10 * 3600_000 })
      toast(t("I'll remind you tomorrow at 10:00"), 'bell')
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      {g && <Aurora key={current?.id} colors={[`${g.a}aa`, `${g.b}88`, `${g.deep}cc`]} intensity={1.5} />}

      <div className="relative z-10 mx-auto flex w-full max-w-[520px] items-center gap-3 px-4 pt-[calc(14px+var(--safe-top))]">
        <button type="button" aria-label={t('Close')} onClick={() => nav(-1)} className="press glass grid h-10 w-10 place-items-center rounded-full"><XIcon size={18} weight="bold" /></button>
        <div className="flex-1">
          <div className="text-center text-[15px] font-semibold">{t('Connection review')}</div>
          {queue && queue.length > 0 && (
            <div className="mt-2 flex gap-1">
              {queue.map((_, i) => (
                <div key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/15">
                  <motion.div className="h-full bg-fg" initial={false} animate={{ width: i < index ? '100%' : '0%' }} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="tnum w-10 text-right text-[13px] text-fg-3">{queue ? `${Math.min(index + 1, queue.length)}/${queue.length}` : ''}</div>
      </div>

      <div className="relative mx-auto flex w-full max-w-[520px] flex-1 items-center justify-center px-6">
        {queue && index < queue.length ? (
          <Deck queue={queue} index={index} onDecide={decide} />
        ) : queue ? (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center text-center">
            <Orb value={100} tone="hot" size={200} />
            <h2 className="mt-4 text-[26px] font-semibold tracking-[-0.02em]">{queue.length ? t('Deck cleared') : people?.length ? t('All connections are on rhythm') : t('No one to review yet')}</h2>
            <p className="mt-2 max-w-[300px] text-[15px] leading-relaxed text-fg-3">
              {queue.length ? t('Marked: {done} · postponed: {later} · remind: {remind}', { done: stats.done, later: stats.later, remind: stats.remind }) : people?.length ? t('No one is waiting for your message right now. Great job.') : t('Add people — and a deck of who to write to will appear here.')}
            </p>
            <button type="button" onClick={() => nav('/')} className="press btn-primary mt-6"><SparkleIcon size={18} weight="fill" />{' '}{t('Done')}</button>
          </motion.div>
        ) : null}
      </div>

      {current && (
        <div className="relative z-10 mx-auto flex w-full max-w-[520px] items-center justify-center gap-4 px-6 pb-[calc(28px+var(--safe-bottom))]">
          <RoundBtn label={t('Later')} onClick={() => decide('later')} color={WARMTH_COLORS.cold}><ClockCountdownIcon size={24} /></RoundBtn>
          <RoundBtn label={t('Remind')} onClick={() => decide('remind')} color={WARMTH_COLORS.warm} small><BellSimpleIcon size={20} /></RoundBtn>
          <RoundBtn label={t('We were in touch')} onClick={() => decide('done')} color="#5fe3b0"><CheckIcon size={26} weight="bold" /></RoundBtn>
        </div>
      )}
    </div>
  )
}

function RoundBtn({ children, label, onClick, color, small }: { children: ReactNode; label: string; onClick: () => void; color: string; small?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="press flex flex-col items-center gap-2">
      <span className="glass-strong grid place-items-center rounded-full" style={{ width: small ? 52 : 64, height: small ? 52 : 64, color, boxShadow: `0 0 30px -8px ${color}` }}>{children}</span>
      <span className="text-[12px] font-medium text-fg-3">{label}</span>
    </button>
  )
}

function Deck({ queue, index, onDecide }: { queue: Person[]; index: number; onDecide: (v: Verdict) => void }) {
  const visible = queue.slice(index, index + 3)
  return (
    <div className="relative h-[min(560px,64dvh)] w-full max-w-[380px]">
      <AnimatePresence>
        {visible.map((p, i) => (
          <CardItem key={p.id} p={p} depth={i} onDecide={onDecide} />
        )).reverse()}
      </AnimatePresence>
    </div>
  )
}

function CardItem({ p, depth, onDecide }: { p: Person; depth: number; onDecide: (v: Verdict) => void }) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useTransform(x, [-220, 220], [-14, 14])
  const okOpacity = useTransform(x, [30, 120], [0, 1])
  const laterOpacity = useTransform(x, [-120, -30], [1, 0])
  const remindOpacity = useTransform(y, [-120, -40], [1, 0])
  const [exitDir, setExitDir] = useState<Verdict | null>(null)
  const reach = useReachOut()
  const g = personGradient(p.id)
  const w = useMemo(() => warmthOf(p), [p])
  const top = depth === 0
  const fan = [0, -5, 5][depth] ?? 0

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info
    if (offset.x > 110 || velocity.x > 700) { setExitDir('done'); onDecide('done') }
    else if (offset.x < -110 || velocity.x < -700) { setExitDir('later'); onDecide('later') }
    else if (offset.y < -110 || velocity.y < -700) { setExitDir('remind'); onDecide('remind') }
    else { animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 }); animate(y, 0, { type: 'spring', stiffness: 500, damping: 30 }) }
  }

  const exit = exitDir === 'done' ? { x: 520, rotate: 20, opacity: 0 } : exitDir === 'later' ? { x: -520, rotate: -20, opacity: 0 } : exitDir === 'remind' ? { y: -700, opacity: 0 } : { x: 520, rotate: 20, opacity: 0 }

  return (
    <motion.div
      className="absolute inset-0"
      style={{ zIndex: 10 - depth, transformOrigin: depth ? '50% 120%' : '50% 50%' }}
      initial={{ scale: 0.9, opacity: 0, y: 30 }}
      animate={{ scale: 1 - depth * 0.05, opacity: 1, y: depth * 14, rotate: fan }}
      exit={{ ...exit, transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] } }}
      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
    >
    <motion.div
      className="h-full"
      style={{ x, y, rotate }}
      drag={top}
      dragElastic={0.85}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02 }}
    >
      <div className="glass-strong relative flex h-full flex-col overflow-hidden rounded-[34px]" style={{ filter: depth ? `brightness(${1 - depth * 0.2})` : undefined }}>
        {/* градиентная обложка */}
        <div className="relative h-[46%] shrink-0 overflow-hidden" style={{ background: `radial-gradient(70% 90% at 25% 10%, ${g.a}, transparent 70%), radial-gradient(70% 80% at 85% 30%, ${g.b}, transparent 70%), linear-gradient(160deg, ${g.deep}, #0b0c14)` }}>
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 40%, rgb(16 16 24 / 0.95))' }} />
          <div className="absolute inset-x-0 bottom-4 flex flex-col items-center">
            <Avatar person={p} size={92} warmth={w.level} ring />
          </div>
        </div>
        <div className="flex flex-1 flex-col px-6 pb-6 pt-3 text-center">
          <div className="text-[25px] font-semibold tracking-[-0.02em]">{fullName(p)}</div>
          <div className="mt-0.5 text-[14px] text-fg-3">{jobLine(p) || p.city}</div>
          <div className="mt-3 flex justify-center">
            <span className="rounded-full px-3 py-1 text-[12.5px] font-semibold" style={{ color: WARMTH_COLORS[w.level], background: `color-mix(in srgb, ${WARMTH_COLORS[w.level]} 14%, transparent)` }}>
              {WARMTH_LABEL[w.level]} · {ago(contactAnchor(p))} · {cadenceLabel(w.cadence).toLowerCase()}
            </span>
          </div>
          <div className="mt-4 flex-1 space-y-2 overflow-hidden text-left">
            {p.topics.filter(topic => !topic.done).slice(0, 2).map(item => (
              <div key={item.id} className="rounded-[16px] bg-white/[0.05] px-3.5 py-2.5 text-[14px] text-fg-2"><span className="text-fg-3">{t('Topic:')}</span> {item.text}</div>
            ))}
            {p.topics.every(topic2 => topic2.done) && (
              <div className="rounded-[16px] bg-white/[0.05] px-3.5 py-2.5 text-[14px] leading-relaxed text-fg-2 line-clamp-3">
                {p.notes || (p.facts[0] && <><span className="text-fg-3">{t('Remember:')}</span> {p.facts[0].text}</>) || (p.metPlace && t('You met: {metPlace}', { metPlace: p.metPlace })) || <span className="text-fg-3">{t("No topics — just ask how they're doing. That's enough.")}</span>}
              </div>
            )}
          </div>
          {top && p.channels.length > 0 && (
            <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => reach(p)} className="press btn-primary mt-4 h-11 w-full text-[15px]">
              <PaperPlaneTiltIcon size={17} weight="bold" /> {CHANNEL_ACTION[(primaryChannel(p) ?? p.channels[0]).type]}
            </button>
          )}
        </div>

        {top && (
          <>
            <motion.div style={{ opacity: okOpacity }} className="pointer-events-none absolute left-6 top-6 -rotate-12 rounded-xl border-[3px] border-mint px-3 py-1 text-[18px] font-extrabold uppercase tracking-wider text-mint">{t('We were in touch')}</motion.div>
            <motion.div style={{ opacity: laterOpacity }} className="pointer-events-none absolute right-6 top-6 rotate-12 rounded-xl border-[3px] border-cold px-3 py-1 text-[18px] font-extrabold uppercase tracking-wider text-cold">{t('Later')}</motion.div>
            <motion.div style={{ opacity: remindOpacity }} className="pointer-events-none absolute inset-x-0 top-[38%] mx-auto w-fit rounded-xl border-[3px] border-warm px-3 py-1 text-[18px] font-extrabold uppercase tracking-wider text-warm">{t('Remind')}</motion.div>
          </>
        )}
      </div>
    </motion.div>
    </motion.div>
  )
}
