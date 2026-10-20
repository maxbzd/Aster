import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCalm } from '@/lib/calm'

describe('quiet during scrolling', () => {
  afterEach(() => vi.useRealTimers())

  it('sets the mark on scroll and removes it after 160 ms of rest', () => {
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

  it('after it is turned off it does not set the mark', () => {
    const off = installCalm()
    off()
    window.dispatchEvent(new Event('scroll'))
    expect(document.documentElement).not.toHaveAttribute('data-calm')
  })
})
