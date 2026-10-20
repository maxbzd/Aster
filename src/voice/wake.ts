import { speechCtor, type SpeechRecognizer } from '@/lib/speech'
import { intlTag } from '@/i18n'

/**
 * Continuous listening: while the app is open, delivers finished phrases. The browser itself ends recognition
 * after a pause, so we restart with a small delay; if the microphone is denied we stop and report it.
 */
export interface WakeListener { stop: () => void }

export function listenContinuously(onFinal: (text: string) => void, onError: (kind: 'denied' | 'unsupported') => void, lang = intlTag()): WakeListener {
  const C = speechCtor()
  if (!C) { onError('unsupported'); return { stop() {} } }
  let on = true
  let rec: SpeechRecognizer | null = null
  let fails = 0
  const start = () => {
    if (!on) return
    const r = new C()
    rec = r
    r.lang = lang
    r.continuous = true
    r.interimResults = false
    r.onresult = e => {
      fails = 0
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!
        if (res.isFinal) { const query = res[0].transcript.trim(); if (query) onFinal(query) }
      }
    }
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { on = false; onError('denied') }
    }
    r.onend = () => {
      if (!on) return
      fails++
      setTimeout(start, Math.min(5000, 300 * fails))
    }
    try { r.start() } catch { setTimeout(start, 1000) }
  }
  start()
  return { stop() { on = false; try { rec?.abort() } catch { /* already stopped */ } } }
}

/** Reads a question aloud. Returns false if speech synthesis is unavailable. */
export function speak(text: string, lang = intlTag()): boolean {
  if (typeof speechSynthesis === 'undefined') return false
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  speechSynthesis.speak(u)
  return true
}
