import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/ai/managed', () => ({ authedFetch: fetchMock }))

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response


describe('the calls to the TickTick function', () => {
  it('status: the three flags, with defaults for anything missing', async () => {
    const { getStatus } = await import('@/ticktick/api')
    fetchMock.mockResolvedValue(reply(200, { configured: true, connected: true, expiresAt: '2027-01-01' }))
    expect(await getStatus()).toEqual({ configured: true, connected: true, expiresAt: '2027-01-01' })
    fetchMock.mockResolvedValue(reply(200, {}))
    expect(await getStatus()).toEqual({ configured: false, connected: false, expiresAt: null })
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/functions\/v1\/ticktick\/status$/)
  })

  it('status: null when the server is unreachable or answers with an error', async () => {
    const { getStatus } = await import('@/ticktick/api')
    fetchMock.mockResolvedValue(reply(500, {}))
    expect(await getStatus()).toBeNull()
    fetchMock.mockImplementation(() => { throw new Error('offline') })
    expect(await getStatus()).toBeNull()
  })

  it('connect: gives the address, or the server\'s reason', async () => {
    const { connectUrl } = await import('@/ticktick/api')
    fetchMock.mockResolvedValue(reply(200, { url: 'https://x/auth' }))
    expect(await connectUrl('https://app/#/me')).toBe('https://x/auth')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ returnTo: 'https://app/#/me' })
    fetchMock.mockResolvedValue(reply(400, { error: 'not set up' }))
    await expect(connectUrl('x')).rejects.toThrow('not set up')
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json') } } as unknown as Response)
    await expect(connectUrl('x')).rejects.toThrow()
  })

  it('disconnect: a POST to /disconnect', async () => {
    const { disconnect } = await import('@/ticktick/api')
    fetchMock.mockResolvedValue(reply(200, {}))
    await disconnect()
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' })
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/disconnect$/)
  })

  it('sync: success fills in what the server left out', async () => {
    const { sync } = await import('@/ticktick/api')
    fetchMock.mockResolvedValue(reply(200, { completed: ['k'] }))
    expect(await sync({ open: [], done: [], tz: 'UTC' })).toEqual({ ok: true, reply: { completed: ['k'], created: 0, closed: 0, errors: [] } })
  })

  it('sync: 409 tells "expired" from "not connected"; other errors carry the message', async () => {
    const { sync } = await import('@/ticktick/api')
    const body = { open: [], done: [], tz: 'UTC' }
    fetchMock.mockResolvedValue(reply(409, { error: 'expired' }))
    expect(await sync(body)).toEqual({ ok: false, reason: 'expired' })
    fetchMock.mockResolvedValue(reply(409, {}))
    expect(await sync(body)).toEqual({ ok: false, reason: 'not_connected' })
    fetchMock.mockResolvedValue(reply(502, { error: 'upstream' }))
    expect(await sync(body)).toEqual({ ok: false, reason: 'error', message: 'upstream' })
    fetchMock.mockImplementation(() => { throw new Error('Failed to fetch') })
    expect(await sync(body)).toEqual({ ok: false, reason: 'error', message: 'Failed to fetch' })
  })
})

describe('the watcher that keeps TickTick in step', () => {
  const api = { getStatus: vi.fn(), sync: vi.fn() }
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); vi.doUnmock('@/ticktick/api') })

  it('starts when someone signs in, syncs on edits and every minute, and stops at sign-out', async () => {
    vi.resetModules()
    vi.doMock('@/ticktick/api', () => api)
    api.getStatus.mockResolvedValue({ configured: true, connected: true, expiresAt: null })
    api.sync.mockResolvedValue({ ok: true, reply: { completed: [], created: 0, closed: 0, errors: [] } })
    const { useCloud } = await import('@/cloud/store')
    const cycle = await import('@/ticktick/cycle')
    // only the minute timer is faked: the test database needs the real clock to answer
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    cycle.installTickTick()
    cycle.installTickTick() // twice does nothing more
    expect(api.getStatus).not.toHaveBeenCalled() // nobody is signed in

    useCloud.setState({ userId: 'u1' })
    await vi.waitFor(() => expect(cycle.getTickState().phase).toBe('idle'))
    expect(api.getStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(api.getStatus).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(cycle.getTickState().phase).toBe('idle'))

    useCloud.setState({ userId: undefined })
    expect(cycle.getTickState().phase).toBe('off')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(api.getStatus).toHaveBeenCalledTimes(2)
  })
})
