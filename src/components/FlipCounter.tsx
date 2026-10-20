import { useEffect, useRef, useState } from 'react'

function FlipDigit({ d, w, h, speed }: { d: string; w: number; h: number; speed: number }) {
  const [cur, setCur] = useState(d)
  const [prev, setPrev] = useState(d)
  const [flip, setFlip] = useState(0)

  useEffect(() => {
    if (d === cur) return
    setPrev(cur)
    setCur(d)
    setFlip(f => f + 1)
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps

  const style = { width: w, height: h, ['--fh' as string]: `${h}px`, ['--fs' as string]: `${speed}ms` }
  return (
    <div className="flip" style={style}>
      <div className="flip-half flip-top"><span>{cur}</span></div>
      <div className="flip-half flip-bottom"><span>{flip ? prev : cur}</span></div>
      {flip > 0 && (
        <div key={flip} className="contents">
          <div className="flip-half flip-top flip-flap-down"><span>{prev}</span></div>
          <div className="flip-half flip-bottom flip-flap-up" onAnimationEnd={() => setPrev(cur)}><span>{cur}</span></div>
        </div>
      )}
      <div className="flip-hinge" />
    </div>
  )
}

/** Перекидной счётчик (CRED). При появлении «прокручивается» от нуля до значения. */
export function FlipCounter({ value, digits, height = 64 }: { value: number; digits?: number; height?: number }) {
  const target = String(Math.max(0, Math.floor(value))).padStart(digits ?? 0, '0')
  const [shown, setShown] = useState(() => target.replace(/\d/g, '0'))
  const timers = useRef<number[]>([])

  useEffect(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    const from = shown.padStart(target.length, '0').slice(-target.length).split('').map(Number)
    const to = target.split('').map(Number)
    to.forEach((to2, i) => {
      let v = from[i]
      let step = 0
      const delay = 220 + i * 140
      while (v !== to2) {
        v = (v + 1) % 10
        const val = v
        step++
        timers.current.push(window.setTimeout(() => {
          setShown(s => {
            const arr = s.padStart(target.length, '0').slice(-target.length).split('')
            arr[i] = String(val)
            return arr.join('')
          })
        }, delay + step * 120))
      }
    })
    return () => timers.current.forEach(clearTimeout)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const w = Math.round(height * 0.68)
  return (
    <div className="flex gap-[5px]" role="img" aria-label={String(value)}>
      {shown.split('').map((d, i) => (
        <FlipDigit key={i} d={d} w={w} h={height} speed={110} />
      ))}
    </div>
  )
}
