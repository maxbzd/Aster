import type { CSSProperties } from 'react'

/** Мягкое свечение-аврора: 2–3 мягких пятна. Не двигаются и без filter: blur: такие слои заставляют видеокарту пересчитывать размытие каждый кадр. */
export function Aurora({
  colors,
  className = '',
  intensity = 1,
  style,
}: { colors: string[]; className?: string; intensity?: number; style?: CSSProperties }) {
  const spots = [
    { left: '-10%', top: '-20%', size: '75%', dur: 38 },
    { left: '40%', top: '-30%', size: '70%', dur: 46 },
    { left: '10%', top: '10%', size: '60%', dur: 54 },
  ]
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} style={style}>
      {colors.slice(0, 3).map((c, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: spots[i].left,
            top: spots[i].top,
            width: spots[i].size,
            aspectRatio: '1',
            background: `radial-gradient(closest-side, ${c}, transparent)`,
            opacity: 0.55 * intensity,
          }}
        />
      ))}
    </div>
  )
}
