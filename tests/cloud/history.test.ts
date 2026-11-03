import { beforeEach, describe, expect, it } from 'vitest'
import { canRestore, conflictLog, restoreLostValue } from '@/cloud/history'
import { installTracking, setMeta, type ConflictEntry } from '@/cloud/engine'
import { db } from '@/data/db'
import { personOf } from './rows'
import { resetDb } from '../helpers'

const entry = (p: Partial<ConflictEntry> = {}): ConflictEntry => ({ table: 'people', id: 'p1', path: 'city', lost: 'Рим', kept: 'remote', at: 1000, ...p })
const log = async (...e: ConflictEntry[]) => setMeta('conflicts', e)
// the app switches the change tracking on at start; here it is switched on by hand
installTracking()
beforeEach(async () => { await resetDb() })

describe('bringing back an edit that lost', () => {
  it('writes the lost value back as a new edit and removes it from the list', async () => {
    await db.people.add(personOf('p1', { city: 'Париж', updatedAt: 5 }))
    const a = entry(); const b = entry({ path: 'company', lost: 'Acme', at: 2000 })
    await log(a, b)
    expect(await restoreLostValue(a)).toBe('restored')
    const row = await db.people.get('p1')
    expect(row?.city).toBe('Рим')
    expect(row!.updatedAt).toBeGreaterThan(5) // a fresh edit, so it travels to the other devices
    expect((await conflictLog()).map(e => e.path)).toEqual(['company'])
    await new Promise(r => setTimeout(r, 40))
    expect(await db.outbox.get('people:p1')).toBeDefined() // and it is queued for sync like any other edit
  })

  it('reaches into nested objects, and can put a field back that was removed', async () => {
    await db.people.add(personOf('p1', { prefs: { food: 'пицца', language: 'ru' } }))
    await restoreLostValue(entry({ path: 'prefs.food', lost: 'суши' }))
    expect((await db.people.get('p1'))?.prefs).toEqual({ food: 'суши', language: 'ru' })
    await restoreLostValue(entry({ path: 'prefs.alcohol', lost: 'no' }))
    expect((await db.people.get('p1'))?.prefs).toMatchObject({ alcohol: 'no' })
  })

  it('says so when the record is gone, and leaves list items to the person', async () => {
    expect(await restoreLostValue(entry())).toBe('gone')
    await db.people.add(personOf('p1'))
    expect(canRestore(entry({ path: 'topics[id:t1].text' }))).toBe(false)
    expect(await restoreLostValue(entry({ path: 'topics[id:t1].text' }))).toBe('unsupported')
    expect(canRestore(entry({ lost: `${'x'.repeat(4000)}…` }))).toBe(false) // a clipped copy would overwrite the text with a stump
    expect(canRestore(entry({ path: 'notes', lost: 'a short note' }))).toBe(true)
  })
})
