import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/data/db'
import { blankPerson } from '@/data/actions'
import type { Reminder } from '@/data/types'
import { buildPayload, idOf, keyOf } from '@/ticktick/payload'

const api = vi.hoisted(() => ({ getStatus: vi.fn(), sync: vi.fn(), connectUrl: vi.fn(), disconnect: vi.fn() }))
vi.mock('@/ticktick/api', () => api)

const NOW = new Date('2026-10-12T10:00:00Z').getTime()
const rem = (over: Partial<Reminder>): Reminder => ({ id: 'r1', text: 'Написать Олегу', dueAt: NOW + 3600_000, done: false, createdAt: NOW - 1000, ...over })

describe('what goes to TickTick', () => {
  it('open reminders: with a title, a due date and the person\'s name', () => {
    const olga = blankPerson({ id: 'p1', firstName: 'Ольга', lastName: 'Сергеева' })
    const p = buildPayload([rem({ personId: 'p1' }), rem({ id: 'r2', text: 'Оплатить', dueAt: NOW })], [olga], NOW, 'Europe/Moscow')
    expect(p.tz).toBe('Europe/Moscow')
    expect(p.open).toEqual([
      { key: 'aster:reminder:r1', title: 'Написать Олегу', notes: 'Aster · Ольга Сергеева', dueAt: new Date(NOW + 3600_000).toISOString() },
      { key: 'aster:reminder:r2', title: 'Оплатить', notes: 'Aster', dueAt: new Date(NOW).toISOString() },
    ])
    expect(p.done).toEqual([])
  })

  it('mirrors of commitments from Orbita are skipped: Orbita sends them', () => {
    const p = buildPayload([rem({ bridgeKey: 'orbita:item:1' }), rem({ id: 'r2', done: true, doneAt: NOW - 1000, bridgeKey: 'orbita:item:2' })], [], NOW)
    expect(p.open).toEqual([])
    expect(p.done).toEqual([])
  })

  it('completed ones are reported for 45 days, after that not', () => {
    const day = 86_400_000
    const p = buildPayload([rem({ id: 'a', done: true, doneAt: NOW - 2 * day }), rem({ id: 'b', done: true, doneAt: NOW - 60 * day }), rem({ id: 'c', done: true })], [], NOW)
    expect(p.done).toEqual(['aster:reminder:a'])
  })

  it('the key and the reminder number convert back and forth', () => {
    expect(idOf(keyOf('abc-1'))).toBe('abc-1')
    expect(idOf('orbita:item:1')).toBeNull()
  })
})

describe('exchange with TickTick', () => {
  beforeEach(async () => {
    vi.resetModules()
    api.getStatus.mockReset(); api.sync.mockReset()
    await db.reminders.clear(); await db.people.clear()
  })

  it('marks a reminder done when TickTick reports the task as closed', async () => {
    await db.reminders.put(rem({ id: 'r9' }))
    api.getStatus.mockResolvedValue({ configured: true, connected: true, expiresAt: null })
    api.sync.mockResolvedValue({ ok: true, reply: { completed: ['aster:reminder:r9', 'orbita:item:x', 'aster:reminder:missing'], created: 1, closed: 0, errors: [] } })
    const { syncNow, getTickState } = await import('@/ticktick/cycle')
    await syncNow()
    expect((await db.reminders.get('r9'))?.done).toBe(true)
    expect(getTickState()).toMatchObject({ phase: 'idle', created: 1 })
    expect(api.sync.mock.calls[0]![0].open.map((i: { key: string }) => i.key)).toEqual(['aster:reminder:r9'])
  })

  it('without a connection it sends nothing', async () => {
    await db.reminders.put(rem({ id: 'r9' }))
    api.getStatus.mockResolvedValue({ configured: true, connected: false, expiresAt: null })
    const { syncNow } = await import('@/ticktick/cycle')
    await syncNow()
    expect(api.sync).not.toHaveBeenCalled()
  })

  it('the token is invalid: state expired, the reminders are not touched', async () => {
    await db.reminders.put(rem({ id: 'r9' }))
    api.getStatus.mockResolvedValue({ configured: true, connected: true, expiresAt: null })
    api.sync.mockResolvedValue({ ok: false, reason: 'expired' })
    const { syncNow, getTickState } = await import('@/ticktick/cycle')
    await syncNow()
    expect(getTickState()).toMatchObject({ expired: true, status: { connected: false } })
    expect((await db.reminders.get('r9'))?.done).toBe(false)
  })

  it('a server error is shown and does not break the app', async () => {
    api.getStatus.mockResolvedValue({ configured: true, connected: true, expiresAt: null })
    api.sync.mockResolvedValue({ ok: false, reason: 'error', message: 'TickTick недоступен' })
    const { syncNow, getTickState } = await import('@/ticktick/cycle')
    await syncNow()
    expect(getTickState()).toMatchObject({ phase: 'error', error: 'TickTick недоступен' })
  })
})

describe('demo data', () => {
  it('while demo data is loaded nothing goes to TickTick', async () => {
    vi.resetModules()
    api.getStatus.mockReset(); api.sync.mockReset()
    api.getStatus.mockResolvedValue({ configured: true, connected: true, expiresAt: null })
    await db.reminders.put(rem({ id: 'demo1' }))
    await db.settings.put({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1, demo: true })
    const { syncNow } = await import('@/ticktick/cycle')
    await syncNow()
    expect(api.sync).not.toHaveBeenCalled()
    await db.settings.clear()
  })
})

describe('the connection with TickTick', () => {
  beforeEach(() => { vi.resetModules(); api.connectUrl.mockReset(); api.disconnect.mockReset(); api.getStatus.mockReset() })

  it('connecting asks the server for the link, with the way back to the profile, and goes there', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'https://app.example', pathname: '/aster/', href: 'https://app.example/aster/', assign })
    api.connectUrl.mockResolvedValue('https://ticktick.example/authorize?x=1')
    const { startConnect } = await import('@/ticktick/cycle')
    await startConnect()
    expect(api.connectUrl).toHaveBeenCalledWith('https://app.example/aster/#/me')
    expect(assign).toHaveBeenCalledWith('https://ticktick.example/authorize?x=1')
    vi.unstubAllGlobals()
  })

  it('disconnecting tells the server, and the state says "not connected" and not "expired"', async () => {
    api.getStatus.mockResolvedValue({ configured: true, connected: true, expiresAt: null })
    api.sync.mockResolvedValue({ ok: true, reply: { completed: [], created: 0, closed: 0, errors: [] } })
    const { syncNow, disconnect, getTickState } = await import('@/ticktick/cycle')
    await syncNow()
    expect(getTickState().status?.connected).toBe(true)
    await disconnect()
    expect(api.disconnect).toHaveBeenCalledTimes(1)
    expect(getTickState()).toMatchObject({ status: { connected: false }, expired: false })
  })

  it('the way back from TickTick is read from the address, and the address is cleaned', async () => {
    window.history.replaceState(null, '', '/?ticktick=denied#/me')
    const { takeReturnResult, returnText } = await import('@/ticktick/cycle')
    expect(takeReturnResult()).toBe('denied')
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#/me')
    expect(takeReturnResult()).toBeNull() // only once
    expect(returnText('denied').length).toBeGreaterThan(5)
    expect(returnText('ok')).not.toBe(returnText('state'))
    expect(returnText('something-new')).toBeTruthy() // an unknown answer still gets a message
  })

  it('a request already running is not doubled: it is repeated once after it ends', async () => {
    vi.useFakeTimers()
    let release!: () => void
    api.getStatus.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ configured: false, connected: false, expiresAt: null }) }))
    api.getStatus.mockResolvedValue({ configured: false, connected: false, expiresAt: null })
    const { syncNow } = await import('@/ticktick/cycle')
    const first = syncNow()
    await syncNow() // asked again while the first is still running
    expect(api.getStatus).toHaveBeenCalledTimes(1)
    release()
    await first
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.getStatus).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
