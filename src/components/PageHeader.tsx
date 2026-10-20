import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'

/** A large title that "collapses" into a compact glass bar on scroll (iOS). */
export function PageHeader({ title, eyebrow, actions, compactTitle }: { title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; compactTitle?: string }) {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const on = () => setCompact(window.scrollY > 64)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <>
      <AnimatePresence>
        {compact && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-x-0 top-0 z-30 lg:left-[264px]"
          >
            <div className="border-b border-line bg-ink/92 pt-[var(--safe-top)]">
              <div className="mx-auto flex h-12 max-w-[760px] items-center justify-between px-5">
                <span className="text-[16px] font-semibold">{compactTitle ?? (typeof title === 'string' ? title : '')}</span>
                <div className="flex items-center gap-2 [&_button]:!h-8 [&_button]:!w-8">{actions}</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <header className="flex items-end justify-between gap-4 px-1 pb-2 pt-[calc(18px+var(--safe-top))]">
        <div className="min-w-0">
          {eyebrow && <div className="micro mb-2 text-fg-3">{eyebrow}</div>}
          <h1 className="text-[34px] font-bold leading-[1.05] tracking-[-0.035em]">{title}</h1>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 pb-1">{actions}</div>}
      </header>
    </>
  )
}
