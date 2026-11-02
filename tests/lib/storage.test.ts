import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNudgeDue, installState, isDataAtRisk, isIos, requestPersistentStorage, snoozeInstallNudge, type Env } from '@/lib/storage'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
const MAC = IPAD_AS_MAC

describe('which platform keeps the data safe', () => {
  it.each<[string, Env, string]>([
    ['iPhone in a Safari tab', { userAgent: IPHONE }, 'ios-browser'],
    ['iPhone, opened from the Home Screen', { userAgent: IPHONE, standalone: true }, 'installed'],
    ['iPad that reports itself as a Mac (it has a touch screen)', { userAgent: IPAD_AS_MAC, platform: 'MacIntel', maxTouchPoints: 5 }, 'ios-browser'],
    ['a real Mac (no touch screen)', { userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 }, 'browser'],
    ['Android Chrome', { userAgent: ANDROID }, 'browser'],
    ['Android, installed', { userAgent: ANDROID, displayStandalone: true }, 'installed'],
    ['no navigator at all', { userAgent: '' }, 'browser'],
  ])('%s', (_name, env, expected) => {
    expect(installState(env)).toBe(expected)
    expect(isDataAtRisk(env)).toBe(expected === 'ios-browser')
  })

  it('isIos does not mistake a Mac for an iPad', () => {
    expect(isIos({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    expect(isIos({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })
})

describe('the reminder to install', () => {
  afterEach(() => localStorage.clear())
  const risky: Env = { userAgent: IPHONE }

  it('is never shown where the data is not at risk', () => {
    expect(installNudgeDue(1_000, { userAgent: ANDROID })).toBe(false)
    expect(installNudgeDue(1_000, { userAgent: IPHONE, standalone: true })).toBe(false)
  })

  it('is shown on iOS in a tab, hidden for three days when dismissed, then comes back', () => {
    expect(installNudgeDue(1_000, risky)).toBe(true)
    snoozeInstallNudge(1_000)
    expect(installNudgeDue(1_000 + 2 * 86_400_000, risky)).toBe(false)
    expect(installNudgeDue(1_000 + 3 * 86_400_000, risky)).toBe(true)
  })

  it('still shows when the browser blocks storage', () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
    try {
      expect(() => snoozeInstallNudge(1)).not.toThrow()
      expect(installNudgeDue(1, risky)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('persistent storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks the browser and reports the answer', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('does not ask again when it is already persistent', async () => {
    const persist = vi.fn()
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('says no when the browser has no such API or throws', async () => {
    vi.stubGlobal('navigator', {})
    expect(await requestPersistentStorage()).toBe(false)
    vi.stubGlobal('navigator', { storage: { persisted: async () => { throw new Error('x') }, persist: async () => true } })
    expect(await requestPersistentStorage()).toBe(false)
  })
})
