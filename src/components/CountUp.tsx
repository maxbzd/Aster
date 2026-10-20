import { animate, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

/** A number that counts up from zero when it comes into view. With "reduced motion" it is shown at once. */
export function CountUp({ value, duration = 1.4, delay = 0, className, format = (n: number) => String(Math.round(n)) }: {
  value: number
  duration?: number
  delay?: number
  className?: string
  format?: (n: number) => string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.4 })
  const reduce = useReducedMotion()
  const [n, setN] = useState(reduce ? value : 0)

  useEffect(() => {
    if (reduce) { setN(value); return }
    if (!seen) return
    const c = animate(0, value, { duration, delay, ease: [0.22, 1, 0.36, 1], onUpdate: v => setN(v) })
    return () => c.stop()
  }, [seen, value, duration, delay, reduce])

  return <span ref={ref} className={`tnum ${className ?? ''}`}>{format(n)}</span>
}
