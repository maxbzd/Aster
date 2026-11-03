import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// the real module is the plugin's; here it is replaced by one that lets the test say "a new version arrived"
const plugin = vi.hoisted(() => ({
  options: undefined as undefined | { onNeedRefresh?: () => void; onRegisteredSW?: (url: string, reg?: { update: () => Promise<void> }) => void },
  update: vi.fn(async (_reload?: boolean) => undefined),
}))
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: typeof plugin.options) => { plugin.options = options; return plugin.update },
}))

beforeEach(() => { plugin.options = undefined; plugin.update.mockClear(); vi.resetModules(); vi.stubEnv('PROD', true) })
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('a new version of the app', () => {
  it('does nothing outside a production build, where there is no service worker', async () => {
    vi.stubEnv('PROD', false)
    const { startUpdates } = await import('@/lib/updates')
    startUpdates()
    await Promise.resolve()
    expect(plugin.options).toBeUndefined()
  })

  it('is announced when it is ready, and only applied (with a reload) when the person says so', async () => {
    const { startUpdates, useUpdate } = await import('@/lib/updates')
    startUpdates()
    await vi.waitFor(() => expect(plugin.options).toBeDefined())
    expect(useUpdate.getState().ready).toBe(false)
    plugin.options!.onNeedRefresh!()
    expect(useUpdate.getState().ready).toBe(true)
    expect(plugin.update).not.toHaveBeenCalled() // nothing was swapped by itself
    useUpdate.getState().apply!()
    expect(plugin.update).toHaveBeenCalledWith(true)
  })

  it('asks the server for a new version every hour and when the app comes back to the front, not while hidden', async () => {
    vi.useFakeTimers()
    const { startUpdates } = await import('@/lib/updates')
    startUpdates()
    await vi.waitFor(() => expect(plugin.options).toBeDefined())
    const update = vi.fn(async () => undefined)
    plugin.options!.onRegisteredSW!('sw.js', { update })
    vi.advanceTimersByTime(60 * 60_000)
    expect(update).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    vi.advanceTimersByTime(60 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(update).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(update).toHaveBeenCalledTimes(2)
  })
})
