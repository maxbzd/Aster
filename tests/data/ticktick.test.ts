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
