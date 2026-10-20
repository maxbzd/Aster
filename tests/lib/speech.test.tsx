import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { speechSupported, useSpeech } from '@/lib/speech'

/** A minimal imitation of the Web Speech API: the tests "speak" and "drop" recognition themselves. */
class FakeRecognition {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  starts = 0
  stopped = false
  aborted = false
  constructor() { FakeRecognition.instances.push(this) }
  start() { this.starts++ }
  stop() { this.stopped = true; this.onend?.() }
  abort() { this.aborted = true }
  say(parts: { text: string; final: boolean }[], from = 0) {
    this.onresult?.({ resultIndex: from, results: parts.map(p => Object.assign([{ transcript: p.text }], { isFinal: p.final })) })
  }
}

const install = () => { (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition }
const uninstall = () => { delete (window as unknown as Record<string, unknown>).SpeechRecognition }

beforeEach(() => {
  FakeRecognition.instances = []
  // the volume meter touches the microphone, which tests do not need
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone)', configurable: true })
})
afterEach(uninstall)

describe('useSpeech', () => {
  it('without browser support: a clear message, not a crash', () => {
    uninstall()
    expect(speechSupported()).toBe(false)
    const { result } = renderHook(() => useSpeech())
    expect(result.current.supported).toBe(false)
    act(() => result.current.start())
    expect(result.current.error).toMatch(/недоступно в этом браузере/)
    expect(result.current.listening).toBe(false)
  })

  it('starting sets the language and continuous recognition', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    expect(rec).toMatchObject({ lang: 'ru-RU', continuous: true, interimResults: true, starts: 1 })
    expect(result.current.listening).toBe(true)
  })

  it('the draft text is visible at once, the final text accumulates separated by spaces', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    act(() => rec.say([{ text: 'привет', final: false }]))
    expect(result.current.interim).toBe('привет')
    expect(result.current.text).toBe('')
    act(() => rec.say([{ text: ' привет мир ', final: true }]))
    expect(result.current.text).toBe('привет мир')
    act(() => rec.say([{ text: ' привет мир ', final: true }, { text: 'как дела', final: true }], 1))
    expect(result.current.text).toBe('привет мир как дела')
    expect(result.current.interim).toBe('')
  })

  it('Chrome ends recognition after a pause on its own: we restart until the person presses "stop"', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    act(() => rec.onend?.())
    expect(rec.starts).toBe(2)
    expect(result.current.listening).toBe(true)
    act(() => result.current.stop())
    expect(rec.stopped).toBe(true)
    expect(result.current.listening).toBe(false)
    expect(rec.starts).toBe(2) // it does not come alive after "stop"
  })

  it('a repeated start does not multiply recognisers', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    act(() => result.current.start())
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('"silence" and "cancel" do not count as errors; a microphone denial does', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    act(() => rec.onerror?.({ error: 'no-speech' }))
    act(() => rec.onerror?.({ error: 'aborted' }))
    expect(result.current.error).toBeNull()
    act(() => rec.onerror?.({ error: 'not-allowed' }))
    expect(result.current.error).toMatch(/Нет доступа к микрофону/)
  })

  it('other failures: "try again", the restart does not loop', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    act(() => rec.onerror?.({ error: 'network' }))
    expect(result.current.error).toMatch(/прервалось/)
    act(() => rec.onend?.())
    expect(rec.starts).toBe(1)
    expect(result.current.listening).toBe(false)
  })

  it('setText lets you edit and reset what was recognised', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.setText('черновик'))
    expect(result.current.text).toBe('черновик')
    act(() => result.current.setText(''))
    expect(result.current.text).toBe('')
  })

  it('when the screen closes, recognition is interrupted', () => {
    install()
    const { result, unmount } = renderHook(() => useSpeech())
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    unmount()
    expect(rec.aborted).toBe(true)
  })

  it('a start that throws gives a message, not a white screen', () => {
    class Broken extends FakeRecognition { start(): void { throw new Error('busy') } }
    ;(window as unknown as Record<string, unknown>).SpeechRecognition = Broken
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    expect(result.current.error).toMatch(/Не удалось включить микрофон/)
    expect(vi.isMockFunction(console.error)).toBe(false)
  })
})
