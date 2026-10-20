import { useCallback, useEffect, useRef, useState } from 'react'
import { intlTag, t } from '@/i18n'

/* Web Speech API браузера. Где именно идёт распознавание, решает сам браузер: Chrome отправляет звук на серверы Google, Safari использует систему. */

interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }

interface SR extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SRWindow = { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }

const Ctor = (): (new () => SR) | null =>
  typeof window === 'undefined' ? null : ((window as unknown as SRWindow).SpeechRecognition || (window as unknown as SRWindow).webkitSpeechRecognition || null)

export const speechSupported = () => !!Ctor()
export const speechCtor = Ctor
export type { SR as SpeechRecognizer, SREvent as SpeechEvent }

export function useSpeech(lang = intlTag()) {
  const [listening, setListening] = useState(false)
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const rec = useRef<SR | null>(null)
  const wantOn = useRef(false)
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null)

  const stopMeter = () => {
    if (!audio.current) return
    cancelAnimationFrame(audio.current.raf)
    for (const item of audio.current.stream.getTracks()) item.stop()
    audio.current.ctx.close().catch(() => {})
    audio.current = null
    setLevel(0)
  }

  // Индикатор громкости для «живой» сферы. На iOS микрофон занят распознаванием — обходимся без метра.
  const startMeter = async () => {
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const an = ctx.createAnalyser()
      an.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.frequencyBinCount)
      const tick = () => {
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += ((v - 128) / 128) ** 2
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
        if (audio.current) audio.current.raf = requestAnimationFrame(tick)
      }
      audio.current = { ctx, stream, raf: requestAnimationFrame(tick) }
    } catch {
      /* без метра */
    }
  }

  const start = useCallback(() => {
    if (wantOn.current) return // уже слушаем — второй распознаватель не запускаем
    const C = Ctor()
    if (!C) { setError(t("Speech recognition isn't available in this browser — use your keyboard's dictation")); return }
    setError(null)
    const r = new C()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.onresult = e => {
      let fin = ''
      let mid = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) fin += res[0].transcript
        else mid += res[0].transcript
      }
      if (fin) setFinalText(item2 => (item2 ? `${item2.trim()} ${fin.trim()}` : fin.trim()))
      setInterim(mid)
    }
    r.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setError(e.error === 'not-allowed' ? t('No microphone access — allow it in your browser settings') : t('Recognition was interrupted — try again'))
      wantOn.current = false
    }
    // Chrome сам останавливает распознавание после паузы — перезапускаем, пока пользователь не нажал «стоп»
    r.onend = () => {
      if (wantOn.current) { try { r.start() } catch { /* уже запущено */ } }
      else { setListening(false); setInterim(''); stopMeter() }
    }
    rec.current = r
    wantOn.current = true
    try {
      r.start()
      setListening(true)
      startMeter()
    } catch {
      setError(t("Couldn't turn on the microphone"))
    }
  }, [lang])

  const stop = useCallback(() => {
    wantOn.current = false
    rec.current?.stop()
    setListening(false)
    stopMeter()
  }, [])

  useEffect(() => () => { wantOn.current = false; rec.current?.abort(); stopMeter() }, [])

  return { supported: speechSupported(), listening, text: finalText, interim, error, level, start, stop, setText: setFinalText }
}
