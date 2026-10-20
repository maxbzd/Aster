import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Starfield } from './Starfield'

export function Page({ children, className = '', bare }: { children: ReactNode; className?: string; bare?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 360, damping: 36 }}
      className={bare ? className : `relative mx-auto w-full max-w-[760px] px-4 pb-[calc(128px+var(--safe-bottom))] sm:px-6 lg:pb-16 ${className}`}
    >
      {children}
    </motion.div>
  )
}

/** Общий фон: глубокий космос + звёзды + едва заметное свечение сверху. */
export function SpaceBackground() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 70% at 50% -10%, #120f2a 0%, #07070f 45%, #05060a 100%)' }} />
      <Starfield className="absolute inset-0" density={0.9} />
    </div>
  )
}
