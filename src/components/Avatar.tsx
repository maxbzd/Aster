import { memo } from 'react'
import type { Person } from '@/data/types'
import { personGradient, WARMTH_COLORS } from '@/lib/colors'
import { initials } from '@/lib/format'
import type { WarmthLevel } from '@/data/logic'

interface Props {
  person: Pick<Person, 'id' | 'firstName' | 'lastName' | 'photo'>
  size?: number
  warmth?: WarmthLevel
  ring?: boolean
  className?: string
  dim?: boolean
}

/** Фото или «жидкий» градиент с инициалами. Кольцо теплоты светится, когда связь горячая. */
export const Avatar = memo(function Avatar({ person, size = 44, warmth, ring = false, className = '', dim }: Props) {
  const g = personGradient(person.id)
  const showRing = ring && warmth && warmth !== 'none'
  const rc = warmth ? WARMTH_COLORS[warmth] : undefined
  const hotGlow = warmth === 'hot' || warmth === 'warm'
  const pad = showRing ? Math.max(2, Math.round(size * 0.06)) : 0

  return (
    <div
      className={`relative shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        padding: pad,
        background: showRing ? `conic-gradient(from 210deg, ${rc}, ${rc}55, ${rc})` : undefined,
        boxShadow: showRing && hotGlow ? `0 0 ${size * 0.35}px -${size * 0.08}px ${rc}` : undefined,
        filter: dim ? 'saturate(0.35) brightness(0.75)' : undefined,
      }}
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-full"
        style={{ boxShadow: showRing ? '0 0 0 2px var(--color-ink)' : 'inset 0 0 0 1px rgb(255 255 255 / 0.08)' }}
      >
        {person.photo ? (
          <img src={person.photo} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div
            className="grid h-full w-full place-items-center font-semibold text-white"
            style={{
              background: `radial-gradient(120% 90% at 20% 15%, ${g.a} 0%, transparent 55%), radial-gradient(100% 100% at 85% 90%, ${g.b} 0%, transparent 60%), linear-gradient(140deg, ${g.a}, ${g.deep})`,
              fontSize: size * 0.36,
              letterSpacing: '-0.02em',
              textShadow: '0 1px 8px rgb(0 0 0 / 0.25)',
            }}
          >
            {initials(person)}
          </div>
        )}
      </div>
    </div>
  )
})
