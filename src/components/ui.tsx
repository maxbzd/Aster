import { motion } from 'motion/react'
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { CaretRightIcon } from '@phosphor-icons/react'
import { haptic } from '@/app/store'

export function IconButton({
  icon: I, label, onClick, size = 44, className = '', active, weight = 'regular', style,
}: { icon: Icon; label: string; onClick?: () => void; size?: number; className?: string; active?: boolean; weight?: 'regular' | 'bold' | 'fill' | 'duotone' | 'light'; style?: CSSProperties }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => { haptic(); onClick?.() }}
      className={`press glass grid shrink-0 place-items-center rounded-full ${active ? 'text-fg' : 'text-fg/90'} ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <I size={Math.round(size * 0.44)} weight={weight} />
    </button>
  )
}

/** A round quick-action button with a label (Revolut). */
export function ActionButton({ icon: I, label, onClick, primary, active }: { icon: Icon; label: string; onClick?: () => void; primary?: boolean; active?: boolean }) {
  return (
    <button type="button" onClick={() => { haptic(); onClick?.() }} className="press flex w-[64px] flex-col items-center gap-2">
      <span
        className={`grid h-[52px] w-[52px] place-items-center rounded-full ${primary ? 'bg-fg text-ink shadow-[0_8px_30px_-8px_rgba(255,255,255,0.45)]' : 'glass'}`}
      >
        <I size={22} weight={primary ? 'bold' : active ? 'fill' : 'regular'} className={active ? 'text-warm' : undefined} />
      </span>
      <span className={`text-[12.5px] font-medium ${active ? 'text-warm' : 'text-fg-2'}`}>{label}</span>
    </button>
  )
}

export function Chip({
  children, active, onClick, color, icon: I, className = '', size = 'md',
}: { children: ReactNode; active?: boolean; onClick?: () => void; color?: string; icon?: Icon; className?: string; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-3.5 text-[14px]'
  return (
    <button
      type="button"
      onClick={() => { haptic(5); onClick?.() }}
      className={`press inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium transition-colors ${h} ${
        active ? 'bg-fg text-ink' : 'border border-line bg-white/[0.05] text-fg-2 hover:text-fg'
      } ${className}`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: active ? 'none' : `0 0 8px ${color}` }} />}
      {I && <I size={15} weight={active ? 'bold' : 'regular'} />}
      {children}
    </button>
  )
}

export function Segmented<T extends string | number>({
  options, value, onChange, className = '',
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`glass-flat relative flex rounded-full p-1 ${className}`}>
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => { haptic(5); onChange(o.value) }}
            className={`relative z-10 h-9 flex-1 rounded-full px-3 text-[13.5px] font-medium transition-colors ${on ? 'text-ink' : 'text-fg-2'}`}
          >
            {on && <motion.span layoutId={`seg-${options.map(x => x.value).join('')}`} className="absolute inset-0 -z-10 rounded-full bg-fg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function SectionTitle({ children, action, onAction, count }: { children: ReactNode; action?: string; onAction?: () => void; count?: number }) {
  return (
    <div className="mb-3 mt-9 flex items-end justify-between px-1">
      <h2 className="text-[21px] font-semibold tracking-[-0.02em]">
        {children}
        {count !== undefined && <span className="ml-2 text-fg-3 tnum">{count}</span>}
      </h2>
      {action && (
        <button type="button" onClick={onAction} className="press -my-2 flex items-center gap-0.5 py-2 pl-3 text-[14px] font-medium text-fg-2 hover:text-fg">
          {action}
          <CaretRightIcon size={14} weight="bold" />
        </button>
      )}
    </div>
  )
}

/** A card that groups rows (Oura / iOS grouped list) */
export function Group({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <div className={className}>
      {title && <div className="micro mb-2.5 px-1 text-fg-3">{title}</div>}
      <div className="glass rows overflow-hidden rounded-[24px]">{children}</div>
    </div>
  )
}

export function Row({
  icon: I, iconColor, label, value, onClick, trailing, sub, children, chevron,
}: { icon?: Icon; iconColor?: string; label?: ReactNode; value?: ReactNode; onClick?: () => void; trailing?: ReactNode; sub?: ReactNode; children?: ReactNode; chevron?: boolean }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${onClick ? 'press hover:bg-white/[0.025]' : ''}`}
    >
      {I && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]" style={{ color: iconColor }}>
          <I size={18} weight="regular" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {label && <div className="text-[15.5px] leading-snug">{label}</div>}
        {sub && <div className="mt-0.5 text-[13px] leading-snug text-fg-3">{sub}</div>}
        {children}
      </div>
      {value && <div className="shrink-0 text-right text-[14.5px] text-fg-2">{value}</div>}
      {trailing}
      {(chevron ?? !!onClick) && <CaretRightIcon size={15} className="shrink-0 text-fg-4" weight="bold" />}
    </Comp>
  )
}

export function Pill({ children, color, className = '' }: { children: ReactNode; color: string; className?: string }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold ${className}`}
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {children}
    </span>
  )
}

export function PrimaryButton({ children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} onClick={e => { haptic(10); rest.onClick?.(e) }} className={`press btn-primary ${className}`}>
      {children}
    </button>
  )
}
export function GlassButton({ children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} onClick={e => { haptic(); rest.onClick?.(e) }} className={`press btn-glass ${className}`}>
      {children}
    </button>
  )
}

export function Empty({ icon: I, title, text, action }: { icon: Icon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="glass glow-card flex flex-col items-center rounded-[28px] px-6 py-10 text-center" style={{ ['--glow' as string]: 'rgb(157 140 255 / 0.25)', ['--gx' as string]: '50%', ['--gy' as string]: '0%' }}>
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-white/[0.06]"><I size={26} weight="duotone" /></span>
      <div className="text-[18px] font-semibold">{title}</div>
      {text && <p className="mt-1.5 max-w-[280px] text-[14.5px] leading-relaxed text-fg-3">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 380, damping: 32 } } },
}
