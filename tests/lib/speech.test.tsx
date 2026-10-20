import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { speechSupported, useSpeech } from '@/lib/speech'

/** Минимальная имитация Web Speech API: тесты сами «говорят» и «роняют» распознавание. */
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
  // метр громкости трогает микрофон — в тестах он не нужен
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone)', configurable: true })
})
afterEach(uninstall)

describe('useSpeech', () => {
  it('без поддержки браузера — понятное сообщение, а не падение', () => {
    uninstall()
    expect(speechSupported()).toBe(false)
    const { result } = renderHook(() => useSpeech())
    expect(result.current.supported).toBe(false)
    act(() => result.current.start())
    expect(result.current.error).toMatch(/недоступно в этом браузере/)
    expect(result.current.listening).toBe(false)
  })

  it('запуск настраивает русский язык и непрерывное распознавание', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    expect(rec).toMatchObject({ lang: 'ru-RU', continuous: true, interimResults: true, starts: 1 })
    expect(result.current.listening).toBe(true)
  })

  it('черновой текст виден сразу, окончательный копится через пробел', () => {
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

  it('Chrome сам завершает распознавание после паузы — перезапускаем, пока человек не нажал «стоп»', () => {
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
    expect(rec.starts).toBe(2) // после «стоп» не оживает
  })

  it('повторный start не плодит распознаватели', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    act(() => result.current.start())
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('«тишина» и «отмена» ошибками не считаются; запрет микрофона — считается', () => {
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

  it('прочие сбои — «попробуй ещё раз», перезапуск не зацикливается', () => {
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

  it('setText позволяет править и сбрасывать распознанное', () => {
    install()
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.setText('черновик'))
    expect(result.current.text).toBe('черновик')
    act(() => result.current.setText(''))
    expect(result.current.text).toBe('')
  })

  it('при закрытии экрана распознавание прерывается', () => {
    install()
    const { result, unmount } = renderHook(() => useSpeech())
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    unmount()
    expect(rec.aborted).toBe(true)
  })

  it('старт, который бросает исключение, даёт сообщение, а не белый экран', () => {
    class Broken extends FakeRecognition { start(): void { throw new Error('busy') } }
    ;(window as unknown as Record<string, unknown>).SpeechRecognition = Broken
    const { result } = renderHook(() => useSpeech())
    act(() => result.current.start())
    expect(result.current.error).toMatch(/Не удалось включить микрофон/)
    expect(vi.isMockFunction(console.error)).toBe(false)
  })
})
