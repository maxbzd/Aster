import { motion, useDragControls, type PanInfo } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { useMediaQuery } from '@/data/hooks'
import { t } from '@/i18n'

interface Props {
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  tall?: boolean
  glow?: string
}

/** A bottom sheet: dragged by the handle, closed by swiping down / Esc / tapping the backdrop. On desktop it is a modal. */
export function Sheet({ onClose, title, subtitle, children, footer, tall, glow = 'rgb(124 92 255 / 0.28)' }: Props) {
  const desktop = useMediaQuery('(min-width: 768px)')
  const controls = useDragControls()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.setAttribute('data-overlay', '')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      document.documentElement.removeAttribute('data-overlay')
    }
  }, [onClose])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 650) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <motion.div
        className="absolute inset-0 bg-black/55"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        className={`glass-strong relative flex w-full flex-col overflow-hidden rounded-t-[34px] md:max-w-[520px] md:rounded-[34px] ${tall ? 'h-[92dvh] md:h-[86dvh]' : 'max-h-[92dvh] md:max-h-[86dvh]'}`}
        initial={desktop ? { opacity: 0, scale: 0.96, y: 16 } : { y: '100%' }}
        animate={desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
        exit={desktop ? { opacity: 0, scale: 0.97, y: 10 } : { y: '100%' }}
        transition={{ type: 'spring', stiffness: 420, damping: 40, mass: 0.9 }}
        drag={desktop ? false : 'y'}
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={onDragEnd}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48" style={{ background: `radial-gradient(70% 100% at 50% 0%, ${glow}, transparent 70%)` }} />
        <div className="relative shrink-0 touch-none px-5 pt-3" onPointerDown={e => controls.start(e)}>
          <div className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-white/20 md:hidden" />
          {(title || subtitle) && (
            <div className="flex items-start justify-between gap-4 pb-3">
              <div className="min-w-0">
                {title && <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h2>}
                {subtitle && <p className="mt-0.5 text-[14px] text-fg-3">{subtitle}</p>}
              </div>
              <button type="button" aria-label={t('Close')} onClick={onClose} className="press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.08] text-fg-2">
                <XIcon size={17} weight="bold" />
              </button>
            </div>
          )}
        </div>
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && <div className="relative shrink-0 border-t border-line px-5 pb-[calc(16px+var(--safe-bottom))] pt-3">{footer}</div>}
      </motion.div>
    </div>
  )
}
