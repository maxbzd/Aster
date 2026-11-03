import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportBackup, importBackup, saveSettings, BackupError } from '@/data/actions'
import { loadDemo } from '@/data/demo'
import { db } from '@/data/db'
import { personOf } from '../cloud/rows'
import { resetDb } from '../helpers'

/** A backup without the moment it was made, rows in a fixed order: two of these are equal exactly when the data is. */
async function snapshot() {
  const { exportedAt: _at, ...rest } = await exportBackup()
  const sorted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) sorted[key] = Array.isArray(value) ? [...value].sort((a, b) => String((a as { id?: string }).id).localeCompare(String((b as { id?: string }).id))) : value
  return JSON.parse(JSON.stringify(sorted)) as Record<string, unknown>
}

beforeEach(async () => { await resetDb() })

describe('your data comes back exactly as it left', () => {
  it('export, wipe everything, import: the second export is the same as the first, field for field', async () => {
    await loadDemo()
    await saveSettings({ name: 'Макс', onboarded: true })
    const before = await snapshot()
    expect((before.people as unknown[]).length).toBeGreaterThan(20)
    expect((before.interactions as unknown[]).length).toBeGreaterThan(50)

    const file = JSON.parse(JSON.stringify(await exportBackup())) // through text, as a file would be
    for (const table of [db.people, db.interactions, db.reminders, db.circles, db.settings, db.intros, db.events, db.leads, db.collections]) await table.clear()
    expect(await db.people.count()).toBe(0)

    await importBackup(file)
    expect(await snapshot()).toEqual(before)
  })

  it('importing the same file twice changes nothing the second time', async () => {
    await loadDemo()
    const file = JSON.parse(JSON.stringify(await exportBackup()))
    await importBackup(file)
    const once = await snapshot()
    await importBackup(file)
    expect(await snapshot()).toEqual(once)
  })
})

describe('a failure in the middle of an import', () => {
  it('rolls everything back: the people who were there are still there, nothing is half-replaced', async () => {
    await db.people.bulkAdd([personOf('keep1', { firstName: 'Ольга' }), personOf('keep2', { firstName: 'Игорь' })])
    const before = await snapshot()
    const file = { app: 'aster', version: 4, people: [personOf('new1', { firstName: 'Чужой' })], collections: [{ id: 'c1' }], settings: [] }

    // the disk gives up while the last table is being written, after the old people were already cleared inside the transaction
    const proto = Object.getPrototypeOf(db.people) as { bulkPut: (...args: unknown[]) => Promise<unknown> }
    const original = proto.bulkPut
    const spy = vi.spyOn(proto, 'bulkPut').mockImplementation(function (this: { name: string }, ...args: unknown[]) {
      return this.name === 'collections' ? Promise.reject(new Error('the disk failed')) : original.apply(this, args)
    })
    await expect(importBackup(file)).rejects.toThrow('the disk failed')
    spy.mockRestore()

    expect(await snapshot()).toEqual(before)
    expect((await db.people.toArray()).map(p => p.id).sort()).toEqual(['keep1', 'keep2'])
    expect(await db.people.get('new1')).toBeUndefined()
  })

  it('a damaged file is refused before anything is touched', async () => {
    await db.people.add(personOf('keep', { firstName: 'Ольга' }))
    const before = await snapshot()
    await expect(importBackup({ app: 'aster', people: [{ firstName: 'без идентификатора' }] })).rejects.toBeInstanceOf(BackupError)
    await expect(importBackup({ app: 'другое-приложение' })).rejects.toBeInstanceOf(BackupError)
    await expect(importBackup(null)).rejects.toBeInstanceOf(BackupError)
    expect(await snapshot()).toEqual(before)
  })
})
