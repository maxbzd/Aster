import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useState } from 'react'
import { useUI } from '@/app/store'
import { t, msg } from '@/i18n'

/** Astra's star. thinking: a pulse, an orbit and flashes. */
export function AstraStar({ size = 24, thinking = false, className = '' }: { size?: number; thinking?: boolean; className?: string }) {
  const id = useId()
  return (
    <span className={`relative inline-grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size }}>
      <span aria-hidden className="absolute inset-[-35%] rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(255 205 150 / 0.45), transparent)', animation: thinking ? 'breathe 1.2s ease-in-out infinite' : undefined }} />
      {thinking && (
        <span aria-hidden className="absolute inset-[-28%] rounded-full border border-dashed border-white/30" style={{ animation: 'spin 3s linear infinite' }}>
          <span className="absolute left-1/2 top-[-2px] h-[4px] w-[4px] -translate-x-1/2 rounded-full bg-[#ffd9a8] shadow-[0_0_6px_2px_rgba(255,210,160,0.7)]" />
        </span>
      )}
      <motion.svg viewBox="0 0 24 24" width={size} height={size} className="relative" animate={thinking ? { rotate: [0, 90, 180], scale: [1, 0.86, 1] } : { rotate: 0, scale: 1 }}
        transition={thinking ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 }}>
        <defs>
          <radialGradient id={id} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" />
            <stop offset="55%" stopColor="#ffd9a8" />
            <stop offset="100%" stopColor="#a796ff" />
          </radialGradient>
        </defs>
        <path d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 16.9 7.1 12.6 1.5 12 7.1 11.4 11.4 7.1 12 1.5Z" fill={`url(#${id})`} />
      </motion.svg>
    </span>
  )
}

const PHRASES: Record<string, string[]> = {
  capture: [msg('Listening closely…'), msg('Sorting things out…'), msg('Looking for acquaintances in your network…'), msg('Working out the dates…')],
  brief: [msg('Flipping through your history…'), msg('Recalling the details…'), msg('Putting the brief together…')],
  ask: [msg('Going through your network…'), msg('Searching by meaning…'), msg("Checking who's strong at what…")],
  drafts: [msg('Choosing the words…'), msg('Writing in your tone…')],
  matches: [msg("Seeing who's looking for what…"), msg('Connecting constellations…'), msg('Checking who already knows each other…')],
  weekly: [msg('Wrapping up the week…'), msg('Setting priorities…')],
  lead: [msg('Reading the card…'), msg('Choosing the first words…')],
  event: [msg('Reading the badges…'), msg('Going through the notes…'), msg('Preparing the cards…')],
}

/** The "Astra is thinking" state: the star plus changing phrases. */
export function AstraThinking({ kind, className = '' }: { kind: keyof typeof PHRASES; className?: string }) {
  const [i, setI] = useState(0)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setInterval(() => setI(x => (x + 1) % PHRASES[kind].length), 1400)
    const v = setTimeout(() => setVisible(true), 200) // instant answers do not flicker
    return () => { clearInterval(timer); clearTimeout(v) }
  }, [kind])
  if (!visible) return <div className={`py-8 ${className}`} style={{ minHeight: 160 }} />
  return (
    <div className={`flex flex-col items-center justify-center gap-4 py-8 ${className}`}>
      <AstraStar size={44} thinking />
      <div className="relative h-6 w-full overflow-hidden text-center">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}
            className="display text-[20px] text-fg-2">
            {t(PHRASES[kind][i]!)}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="h-[3px] w-40 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 rounded-full" style={{ background: 'linear-gradient(90deg, transparent, #ffd9a8, #a796ff, transparent)', animation: 'shimmer 1.4s linear infinite', backgroundSize: '200% 100%' }} />
      </div>
    </div>
  )
}

/** A source label: a cloud model or the local brain. */
export function SourceBadge({ source, error }: { source: 'ai' | 'local'; error?: string }) {
  const open = useUI(s => s.open)
  if (source === 'ai') {
    return (
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[linear-gradient(90deg,rgba(255,217,168,0.16),rgba(167,150,255,0.16))] px-2.5 text-[11.5px] font-semibold text-[#ffe2c2]">
        <AstraStar size={11} />{' '}{t('Astra')}
      </span>
    )
  }
  return (
    <button type="button" onClick={() => open({ kind: 'astra' })} title={error ?? t('Running on this device. Connect a model to make it smarter.')}
      className="hit inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-2.5 text-[11.5px] font-medium text-fg-3 hover:text-fg-2">
      <span className="text-[10px]">◇</span> {error ? t('Basic mode · offline') : t('Basic mode')}
    </button>
  )
}

/** The outline of a "live" AI block: a softly shimmering frame. */
export const astraGlow = {
  background: 'linear-gradient(var(--color-ink-2), var(--color-ink-2)) padding-box, conic-gradient(from var(--a, 0deg), rgb(255 217 168 / 0.55), rgb(167 150 255 / 0.55), rgb(116 166 255 / 0.4), rgb(255 217 168 / 0.55)) border-box',
  border: '1px solid transparent',
} as const
