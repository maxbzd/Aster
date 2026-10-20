import { motion } from 'motion/react'
import { useId, useMemo, useRef, useState } from 'react'
import type { WarmthPoint } from '@/data/history'
import { WARMTH_COLORS } from '@/lib/colors'
import { calendarNames } from '@/lib/calendar'
import { t, tn } from '@/i18n'

const W = 360
const H = 210
const PAD = { l: 6, r: 6, t: 14, b: 30 }
const PLOT_H = H - PAD.t - PAD.b - 20 // the line above, the activity strip below
const BAR_H = 16


/** Monotone cubic interpolation: the line is smooth and does not "overshoot" the values. */
function smooth(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return ''
  const n = pts.length
  const dx = pts.slice(1).map((p, i) => p.x - pts[i]!.x)
  const m = pts.slice(1).map((p, i) => (p.y - pts[i]!.y) / dx[i]!)
  const result = [m[0]!]
  for (let i = 1; i < n - 1; i++) result.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2)
  result.push(m[n - 2]!)
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3
    d += ` C ${pts[i]!.x + h} ${pts[i]!.y + result[i]! * h}, ${pts[i + 1]!.x - h} ${pts[i + 1]!.y - result[i + 1]! * h}, ${pts[i + 1]!.x} ${pts[i + 1]!.y}`
  }
  return d
}

export const warmthColorOf = (score: number) => (score >= 80 ? WARMTH_COLORS.hot : score >= 55 ? WARMTH_COLORS.warm : score >= 25 ? WARMTH_COLORS.cooling : WARMTH_COLORS.cold)
export const warmthWord = (score: number) => (score >= 80 ? t('hot') : score >= 55 ? t('warm') : score >= 25 ? t('cooling') : t('cold'))

/**
 * How the connection changed: a warmth line by month with contact bars beneath it. Slide a finger to see a month.
 * The line's gradient runs from warm orange at the top to cold blue at the bottom, so "cooled" periods show in colour.
 */
export function WarmthChart({ points }: { points: WarmthPoint[] }) {
  const id = useId().replace(/:/g, '')
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const geo = useMemo(() => {
    const n = points.length
    const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r))
    const y = (s: number) => PAD.t + (1 - s / 100) * PLOT_H
    const scored = points.map((p, i) => ({ p, i })).filter(({ p }) => p.score !== null)
    const xy = scored.map(({ p, i }) => ({ x: x(i), y: y(p.score as number) }))
    const line = smooth(xy)
    const area = xy.length > 1 ? `${line} L ${xy.at(-1)!.x} ${PAD.t + PLOT_H} L ${xy[0]!.x} ${PAD.t + PLOT_H} Z` : ''
    const maxAct = Math.max(1, ...points.map(p => p.activity))
    let lastX = -999
    const years = points.map((p, i) => ({ p, i })).filter(({ p }) => new Date(p.t).getMonth() === 0 || p === points[0]).filter(({ i }) => { const px = x(i); if (px - lastX < 34) return false; lastX = px; return true })
    return { x, y, line, area, maxAct, years, xy }
  }, [points])

  const point = hover === null ? null : points[hover]
  const label = point ? `${calendarNames().monthsNom[new Date(point.t).getMonth()]!.toLowerCase()} ${new Date(point.t).getFullYear()}` : ''
  const at = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const rel = ((clientX - r.left) / r.width) * W
    let best = 0
    for (let i = 0; i < points.length; i++) if (Math.abs(geo.x(i) - rel) < Math.abs(geo.x(best) - rel)) best = i
    setHover(best)
  }
  const last = points.at(-1)

  return (
    <div ref={box} className="relative select-none touch-pan-y" onPointerMove={e => at(e.clientX)} onPointerDown={e => at(e.clientX)} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: 'auto', display: 'block' }} role="img" aria-label={last?.score != null ? t('Connection warmth by month. Currently {warmthWord}.', { warmthWord: warmthWord(last.score) }) : t('Connection warmth by month')}>
        <defs>
          <linearGradient id={`line-${id}`} gradientUnits="userSpaceOnUse" x1="0" y1={PAD.t} x2="0" y2={PAD.t + PLOT_H}>
            <stop offset="0%" stopColor={WARMTH_COLORS.hot} />
            <stop offset="22%" stopColor={WARMTH_COLORS.warm} />
            <stop offset="62%" stopColor={WARMTH_COLORS.cooling} />
            <stop offset="100%" stopColor={WARMTH_COLORS.cold} />
          </linearGradient>
          <linearGradient id={`area-${id}`} gradientUnits="userSpaceOnUse" x1="0" y1={PAD.t} x2="0" y2={PAD.t + PLOT_H}>
            <stop offset="0%" stopColor={WARMTH_COLORS.hot} stopOpacity="0.34" />
            <stop offset="60%" stopColor={WARMTH_COLORS.cooling} stopOpacity="0.1" />
            <stop offset="100%" stopColor={WARMTH_COLORS.cold} stopOpacity="0" />
          </linearGradient>
          <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" /></filter>
        </defs>

        {/* levels */}
        {[100, 75, 50, 25].map(s => (
          <g key={s}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(s)} y2={geo.y(s)} stroke="rgb(255 255 255 / 0.06)" strokeDasharray={s === 75 ? '0' : '2 6'} />
          </g>
        ))}
        <text x={W - PAD.r} y={geo.y(75) - 4} textAnchor="end" fontSize="9" fill="rgb(235 235 245 / 0.32)">{t('on rhythm')}</text>

        {/* contact bars */}
        {points.map((p, i) => {
          if (p.activity <= 0) return null
          const h = Math.max(4, (p.activity / geo.maxAct) * BAR_H)
          return (
            <motion.rect key={p.t} x={geo.x(i) - 1.8} y={H - PAD.b + 4 + BAR_H - h} width="3.6" height={h} rx="1.8" fill="rgb(255 255 255)" opacity={hover === i ? 0.7 : 0.28}
              initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.7, delay: Math.min(i * 0.012, 0.6), ease: [0.22, 1, 0.36, 1] }}
              style={{ transformOrigin: 'center bottom', transformBox: 'fill-box' }} />
          )
        })}

        {geo.area && <motion.path d={geo.area} fill={`url(#area-${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.3 }} />}
        {geo.line && (
          <>
            <motion.path d={geo.line} fill="none" stroke={`url(#line-${id})`} strokeWidth="5" strokeLinecap="round" opacity="0.5" filter={`url(#glow-${id})`} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }} />
            <motion.path d={geo.line} fill="none" stroke={`url(#line-${id})`} strokeWidth="2.2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }} />
          </>
        )}

        {/* axes: years */}
        {geo.years.map(({ p, i }) => (
          <g key={p.t}>
            <line x1={geo.x(i)} x2={geo.x(i)} y1={PAD.t} y2={H - PAD.b + 2} stroke="rgb(255 255 255 / 0.07)" />
            <text x={geo.x(i) + 3} y={H - 5} fontSize="10" fontWeight="600" fill="rgb(235 235 245 / 0.5)">{new Date(p.t).getFullYear()}</text>
          </g>
        ))}

        {/* the current value */}
        {geo.xy.length > 0 && last?.score != null && (
          <g>
            <circle className="pulse-dot ambient" cx={geo.xy.at(-1)!.x} cy={geo.xy.at(-1)!.y} r="6" fill={warmthColorOf(last.score)} opacity="0.25" />
            <circle cx={geo.xy.at(-1)!.x} cy={geo.xy.at(-1)!.y} r="3.4" fill={warmthColorOf(last.score)} stroke="#05060a" strokeWidth="1.6" />
          </g>
        )}

        {/* pointer */}
        {point && (
          <g pointerEvents="none">
            <line x1={geo.x(hover!)} x2={geo.x(hover!)} y1={PAD.t} y2={H - PAD.b + 2} stroke="rgb(255 255 255 / 0.35)" strokeDasharray="3 4" />
            {point.score !== null && <circle cx={geo.x(hover!)} cy={geo.y(point.score)} r="3.8" fill={warmthColorOf(point.score)} stroke="#05060a" strokeWidth="1.6" />}
          </g>
        )}
      </svg>

      {point && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-[14px] border border-line-2 bg-ink-2 px-3 py-2 text-center shadow-lg"
          style={{ left: `clamp(60px, ${(geo.x(hover!) / W) * 100}%, calc(100% - 60px))` }}>
          <div className="text-[12px] font-semibold capitalize">{label}</div>
          <div className="mt-0.5 text-[11.5px]" style={{ color: point.score === null ? undefined : warmthColorOf(point.score) }}>
            {point.score === null ? t('not acquainted yet') : `${warmthWord(point.score)} · ${point.score}`}
          </div>
          <div className="text-[11px] text-fg-3">{point.count ? tn(point.count, '{n} contact', '{n} contacts') : t('no contacts')}</div>
        </div>
      )}
    </div>
  )
}
