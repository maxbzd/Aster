import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listenContinuously, speak } from '@/voice/wake'

class FakeRecognition {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  aborted = false
  failStart = false
  constructor() { FakeRecognition.instances.push(this) }
  start() { if (this.failStart) throw new Error('already started') }
  abort() { this.aborted = true }
  say(parts: { text: string; final: boolean }[]) {
    this.onresult?.({ resultIndex: 0, results: parts.map(p => Object.assign([{ transcript: p.text }], { isFinal: p.final })) })
  }
}
const last = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]!

beforeEach(() => {
  vi.useFakeTimers()
  FakeRecognition.instances = []
  ;(window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition
})
afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as Record<string, unknown>).SpeechRecognition
})

describe('listening continuously', () => {
  it('reports "unsupported" when the browser cannot recognise speech', () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition
    const onError = vi.fn()
    const l = listenContinuously(vi.fn(), onError)
    expect(onError).toHaveBeenCalledWith('unsupported')
    expect(() => l.stop()).not.toThrow()
  })

  it('hands over only finished, non-empty phrases', () => {
    const onFinal = vi.fn()
    listenContinuously(onFinal, vi.fn(), 'en-US')
    const r = last()
    expect(r.lang).toBe('en-US')
    expect(r.continuous).toBe(true)
    r.say([{ text: 'who is  ', final: false }, { text: '  call Nina  ', final: true }, { text: '   ', final: true }])
    expect(onFinal).toHaveBeenCalledOnce()
    expect(onFinal).toHaveBeenCalledWith('call Nina')
  })

  it('restarts after the browser ends recognition, waiting longer after each quick failure', () => {
    listenContinuously(vi.fn(), vi.fn())
    last().onend?.()
    vi.advanceTimersByTime(299)
    expect(FakeRecognition.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeRecognition.instances).toHaveLength(2)
    last().onend?.()
    vi.advanceTimersByTime(599)
    expect(FakeRecognition.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeRecognition.instances).toHaveLength(3)
  })

  it('a heard phrase resets the waiting time', () => {
    listenContinuously(vi.fn(), vi.fn())
    last().onend?.(); vi.advanceTimersByTime(300)
    last().onend?.(); vi.advanceTimersByTime(600)
    last().say([{ text: 'hi', final: true }])
    last().onend?.()
    vi.advanceTimersByTime(300)
    expect(FakeRecognition.instances).toHaveLength(4)
  })

  it('a denied microphone stops everything and says so once', () => {
    const onError = vi.fn()
    listenContinuously(vi.fn(), onError)
    last().onerror?.({ error: 'not-allowed' })
    last().onend?.()
    vi.advanceTimersByTime(10_000)
    expect(onError).toHaveBeenCalledExactlyOnceWith('denied')
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('other errors (no speech, network) are not fatal', () => {
    const onError = vi.fn()
    listenContinuously(vi.fn(), onError)
    last().onerror?.({ error: 'no-speech' })
    expect(onError).not.toHaveBeenCalled()
  })

  it('stop() aborts the current recognition and nothing restarts', () => {
    const l = listenContinuously(vi.fn(), vi.fn())
    const r = last()
    l.stop()
    expect(r.aborted).toBe(true)
    r.onend?.()
    vi.advanceTimersByTime(10_000)
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('a start that throws is tried again a second later', () => {
    class Flaky extends FakeRecognition { override failStart = true }
    ;(window as unknown as Record<string, unknown>).SpeechRecognition = Flaky
    listenContinuously(vi.fn(), vi.fn())
    expect(FakeRecognition.instances).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(FakeRecognition.instances).toHaveLength(2)
  })
})

describe('speak', () => {
  it('false when the browser cannot speak', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(speak('hello')).toBe(false)
    vi.unstubAllGlobals()
  })

  it('cancels what was being said and reads the new text in the chosen language', () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; constructor(public text: string) {} })
    expect(speak('hello', 'en-GB')).toBe(true)
    expect(synth.cancel).toHaveBeenCalledOnce()
    expect(synth.speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', lang: 'en-GB' }))
    vi.unstubAllGlobals()
  })
})
