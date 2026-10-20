import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect } from 'react'

const TONES = {
  hot: { core: '#fff3de', mid: '#ffb36b', edge: '#ff6a3d', halo: 'rgb(255 140 70 / 0.55)' },
  warm: { core: '#fff6e0', mid: '#ffd27a', edge: '#ff9a52', halo: 'rgb(255 200 110 / 0.45)' },
  cooling: { core: '#f1ecff', mid: '#b4a4ff', edge: '#6d4dff', halo: 'rgb(150 120 255 / 0.5)' },
  cold: { core: '#e8f2ff', mid: '#8fb8ff', edge: '#3d6bff', halo: 'rgb(90 140 255 / 0.5)' },
} as const
export type OrbTone = keyof typeof TONES

/** A glowing orb (Gentler Streak) plus a thin progress arc (WHOOP). */
export function Orb({ value, tone, size = 240, label }: { value: number; tone: OrbTone; size?: number; label?: string }) {
  const tone2 = TONES[tone]
  const mv = useMotionValue(0)
  const shown = useTransform(mv, v => Math.round(v))
  const dash = useTransform(mv, v => `${(v / 100) * 289} 289`)

  useEffect(() => {
    const c = animate(mv, value, { duration: 1.6, ease: [0.22, 1, 0.36, 1] })
    return () => c.stop()
  }, [value, mv])

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* halo */}
      <div
        className="absolute rounded-full"
        style={{ inset: -size * 0.28, background: `radial-gradient(closest-side, ${tone2.halo}, transparent 72%)` }}
      />
      {/* sphere */}
      <div
        className="ambient absolute rounded-full"
        style={{
          inset: size * 0.13,
          background: `radial-gradient(60% 60% at 50% 42%, ${tone2.core} 0%, ${tone2.mid} 38%, ${tone2.edge} 72%, transparent 100%)`,
          boxShadow: `0 0 ${size * 0.25}px ${tone2.halo}, inset 0 -${size * 0.06}px ${size * 0.12}px rgb(0 0 0 / 0.18)`,
          animation: 'breathe 6s ease-in-out infinite',
          opacity: 0.92,
        }}
      />
      {/* swirl texture */}
      <div
        className="ambient absolute rounded-full"
        style={{
          inset: size * 0.13,
          background: `conic-gradient(from 0deg, transparent, rgb(255 255 255 / 0.16), transparent 30%, rgb(255 255 255 / 0.1), transparent 60%)`,
          animation: 'spin 28s linear infinite',
        }}
      />
      {/* progress arc */}
      <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" style={{ overflow: 'visible' }}>
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="0.6" />
        <motion.circle cx="50" cy="50" r="46" fill="none" stroke="rgb(255 255 255 / 0.85)" strokeWidth="0.9" strokeLinecap="round" style={{ strokeDasharray: dash }} />
      </svg>
      <div className="relative text-center" style={{ color: '#1a0f08' }}>
        <motion.div className="tnum font-semibold leading-none" style={{ fontSize: size * 0.27, letterSpacing: '-0.05em', color: 'rgb(20 12 30 / 0.88)' }}>
          {shown}
        </motion.div>
        {label && <div className="micro mt-2" style={{ color: 'rgb(20 12 30 / 0.6)' }}>{label}</div>}
      </div>
    </div>
  )
}
