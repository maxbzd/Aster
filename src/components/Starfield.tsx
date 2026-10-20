import { useEffect, useRef } from 'react'

interface Star { x: number; y: number; r: number; a: number; c: string }

/**
 * The starry sky. The stars are drawn once onto two layers; twinkling is a smooth change of the second layer's opacity done in CSS.
 * So there is no JS and no canvas redraw in any frame: the GPU just composites ready layers. The sky used to be redrawn
 * 20 times a second, and on phones that showed as lag.
 */
export function Starfield({ density = 1, className = '' }: { density?: number; className?: string }) {
  const still = useRef<HTMLCanvasElement>(null)
  const blink = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const a = still.current!
    const b = blink.current!
    const ctxA = a.getContext('2d')!
    const ctxB = b.getContext('2d')!
    let cw = 0
    let ch = 0
    const tints = ['255,255,255', '255,255,255', '210,220,255', '255,228,205', '200,190,255']

    const dot = (ctx: CanvasRenderingContext2D, s: Star) => {
      ctx.beginPath()
      ctx.fillStyle = `rgba(${s.c},${s.a})`
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
      if (s.r > 0.9) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 7)
        g.addColorStop(0, `rgba(${s.c},${s.a * 0.35})`)
        g.addColorStop(1, `rgba(${s.c},0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r * 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = `rgba(${s.c},${s.a * 0.4})`
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(s.x - s.r * 6, s.y); ctx.lineTo(s.x + s.r * 6, s.y)
        ctx.moveTo(s.x, s.y - s.r * 6); ctx.lineTo(s.x, s.y + s.r * 6)
        ctx.stroke()
      }
    }

    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = a.clientWidth
      const h = a.clientHeight
      // the address bar on a phone "breathes" while scrolling: small height changes must not recreate the sky
      if (cw && w === cw && Math.abs(h - ch) < 160) return
      cw = w
      ch = h
      for (const [cv, ctx] of [[a, ctxA], [b, ctxB]] as const) {
        cv.width = w * dpr
        cv.height = h * dpr
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      const n = Math.round(((w * h) / 5200) * density)
      for (let i = 0; i < n; i++) {
        const big = Math.random() < 0.035
        const s: Star = {
          x: Math.random() * w,
          y: Math.random() * h,
          r: big ? 0.9 + Math.random() * 0.8 : 0.25 + Math.random() * 0.75,
          a: big ? 0.9 : 0.15 + Math.random() * 0.6,
          c: tints[Math.floor(Math.random() * tints.length)],
        }
        // every third star twinkles: it is on the second layer
        dot(i % 3 === 0 ? ctxB : ctxA, s)
      }
    }

    paint()
    window.addEventListener('resize', paint)
    return () => window.removeEventListener('resize', paint)
  }, [density])

  return (
    <>
      <canvas ref={still} aria-hidden className={`pointer-events-none h-full w-full ${className}`} />
      <canvas ref={blink} aria-hidden className={`ambient pointer-events-none absolute inset-0 h-full w-full ${className}`} style={{ animation: 'twinkle 6s ease-in-out infinite' }} />
    </>
  )
}
