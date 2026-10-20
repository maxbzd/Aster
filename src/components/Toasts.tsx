import { AnimatePresence, motion } from 'motion/react'
import { BellRingingIcon, CheckIcon, InfoIcon } from '@phosphor-icons/react'
import { useUI } from '@/app/store'

const ICONS = { check: CheckIcon, info: InfoIcon, bell: BellRingingIcon }

export function Toasts() {
  const toasts = useUI(s => s.toasts)
  const dismiss = useUI(s => s.dismissToast)
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[calc(12px+var(--safe-top))] z-[70] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map(toast => {
          const I = ICONS[toast.icon ?? 'check']
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -18, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
              className={`glass-strong flex max-w-full items-center gap-2.5 rounded-[26px] py-2 pl-2.5 text-[14.5px] font-medium ${toast.action ? 'pointer-events-auto pr-2' : 'pr-4'}`}
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink ${toast.icon === 'check' ? 'bg-mint/90' : 'bg-fg'}`}><I size={15} weight="bold" /></span>
              <span className="py-0.5">{toast.text}</span>
              {toast.action && (
                <button type="button" onClick={() => { toast.action!.run(); dismiss(toast.id) }} className="press ml-1 h-8 shrink-0 rounded-full bg-fg px-3.5 text-[13.5px] font-semibold text-ink">
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
