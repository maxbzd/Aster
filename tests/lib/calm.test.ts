import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCalm } from '@/lib/calm'

describe('тишина на время прокрутки', () => {
  afterEach(() => vi.useRealTimers())

  it('ставит метку при прокрутке и снимает через 160 мс покоя', () => {
    vi.useFakeTimers()
    const off = installCalm()
    window.dispatchEvent(new Event('scroll'))
    expect(document.documentElement).toHaveAttribute('data-calm')
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(100)
    expect(document.documentElement).toHaveAttribute('data-calm')
    vi.advanceTimersByTime(80)
    expect(document.documentElement).not.toHaveAttribute('data-calm')
    off()
  })

  it('после отключения метку не ставит', () => {
    const off = installCalm()
    off()
    window.dispatchEvent(new Event('scroll'))
    expect(document.documentElement).not.toHaveAttribute('data-calm')
  })
})
