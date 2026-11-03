import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freeUpSpace } from '@/data/actions'
import { db } from '@/data/db'
import { isQuotaError, resolveFull, storageLevel, useStorageHealth } from '@/lib/storageHealth'
import { personOf } from '../cloud/rows'
import { resetDb } from '../helpers'

beforeEach(async () => {
  await resetDb()
  resolveFull()
  useStorageHealth.setState({ usage: null, quota: null, failedAt: null })
})
afterEach(() => vi.restoreAllMocks())

describe('recognising a full storage', () => {
  it('knows the names the browsers use, and the error Dexie wraps around them', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true)
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
    expect(isQuotaError({ name: 'UnknownError', code: 22 })).toBe(true)
    expect(isQuotaError({ name: 'AbortError', message: 'Transaction aborted', inner: { name: 'QuotaExceededError' } })).toBe(true)
    expect(isQuotaError(new Error('The quota has been exceeded'))).toBe(true)
  })

  it('does not cry wolf for other failures', () => {
    expect(isQuotaError(new Error('network down'))).toBe(false)
    expect(isQuotaError(new DOMException('bad key', 'DataError'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
    expect(isQuotaError('quota')).toBe(false)
  })
})

describe('a write the browser refuses', () => {
  it('is announced, still thrown to the caller, and leaves what was saved before untouched', async () => {
    await db.people.add(personOf('before', { firstName: 'Ольга' }))
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('no room', 'QuotaExceededError') })
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => { throw new DOMException('no room', 'QuotaExceededError') })

    await expect(db.people.add(personOf('after', { firstName: 'Игорь' }))).rejects.toBeDefined()
    expect(useStorageHealth.getState().full).toBe(true)
    expect(storageLevel(useStorageHealth.getState())).toBe('full')
    put.mockRestore(); add.mockRestore()
    expect(await db.people.get('after')).toBeUndefined() // the refused change is not half-saved
    expect((await db.people.get('before'))?.firstName).toBe('Ольга') // nothing earlier was lost
  })

  it('clears the notice by itself once writes work again', async () => {
    useStorageHealth.setState({ full: true })
    await db.people.add(personOf('p1'))
    expect(useStorageHealth.getState().full).toBe(false)
  })

  it('another kind of failure raises no alarm', async () => {
    await db.people.add(personOf('dup'))
    await expect(db.people.add(personOf('dup'))).rejects.toBeDefined() // a duplicate key
    expect(useStorageHealth.getState().full).toBe(false)
  })
})

describe('making room', () => {
  it('clears only what can be rebuilt, and reports how much', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга' }))
    await db.aiCache.bulkAdd([{ key: 'a', at: 1, value: 'x' }, { key: 'b', at: 2, value: 'y' }] as never)
    expect(await freeUpSpace()).toBe(2)
    expect(await db.aiCache.count()).toBe(0)
    expect(await db.people.count()).toBe(1)
  })
})

describe('the early warning', () => {
  const level = (usage: number | null, quota: number | null) => storageLevel({ full: false, usage, quota })
  it('stays quiet while there is room, or when the browser does not say', () => {
    expect(level(10 * 2 ** 20, 10 * 2 ** 30)).toBe('ok')
    expect(level(null, null)).toBe('ok')
    expect(level(5, 0)).toBe('ok')
  })
  it('speaks from 90 percent, or when under 25 MB are left', () => {
    expect(level(9.1 * 2 ** 30, 10 * 2 ** 30)).toBe('almost')
    expect(level(480 * 2 ** 20, 500 * 2 ** 20)).toBe('almost')
    expect(level(8 * 2 ** 30, 10 * 2 ** 30)).toBe('ok')
  })
})
