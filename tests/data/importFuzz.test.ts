import { beforeEach, describe, expect, it } from 'vitest'
import { BackupError, exportBackup, importBackup } from '@/data/actions'
import { db } from '@/data/db'
import { personOf } from '../cloud/rows'
import { resetDb } from '../helpers'

function rng(seed: number) {
  let s = seed
  const next = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
  return { next, int: (n: number) => Math.floor(next() * n) }
}

/** Damage a copy of the backup in one random way: drop a field, give it the wrong type, empty a table, break an id. */
function damage(data: Record<string, unknown>, r: ReturnType<typeof rng>): Record<string, unknown> {
  const copy = structuredClone(data) as Record<string, any>
  const tables = ['people', 'interactions', 'reminders', 'circles', 'intros', 'events', 'leads', 'collections'].filter(t => Array.isArray(copy[t]) && copy[t].length)
  const table = tables[r.int(tables.length)]!
  const row = copy[table][r.int(copy[table].length)]
  const fields = Object.keys(row)
  const field = fields[r.int(fields.length)]!
  const wrong: unknown[] = [null, 42, 'x', [], {}, true, [null], { a: 1 }, -1, '']
  switch (r.int(7)) {
    case 0: delete row[field]; break
    case 1: row[field] = wrong[r.int(wrong.length)]; break
    case 2: copy[table] = wrong[r.int(wrong.length)]; break
    case 3: copy[table] = []; break
    case 4: row.id = wrong[r.int(wrong.length)]; break
    case 5: copy[table].push(null); break
    default: copy.version = wrong[r.int(wrong.length)]; break
  }
  return copy
}

const snapshot = async () => JSON.stringify(await Promise.all(db.tables.map(async t => [t.name, (await t.toArray()).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))])))

describe('importing a damaged backup (random damage)', () => {
  let original: Record<string, unknown>
  beforeEach(async () => {
    await resetDb()
    await db.people.bulkAdd([personOf('a', { firstName: 'Анна', tags: ['джаз'] }), personOf('b', { firstName: 'Борис', links: [{ personId: 'a', label: 'знакомы' }] })])
    await db.interactions.add({ id: 'i1', type: 'meeting', personIds: ['a', 'b'], date: 1, createdAt: 1, title: 'Кофе' } as never)
    await db.reminders.add({ id: 'r1', text: 'Позвонить', dueAt: 5, done: false, createdAt: 1, personId: 'a' } as never)
    original = JSON.parse(JSON.stringify(await exportBackup()))
  })

  it('is either refused with a plain message and nothing changed, or imported completely: never a crash, never half', async () => {
    const crashes: string[] = []
    let refused = 0
    let accepted = 0
    for (let i = 0; i < 400; i++) {
      const bad = damage(original, rng(i + 1))
      await resetDb()
      await db.people.add(personOf('keep', { firstName: 'Прежний' }))
      const before = await snapshot()
      try {
        await importBackup(bad, { mode: 'replace' })
        accepted++
      } catch (e) {
        if (e instanceof BackupError) {
          refused++
          if ((await snapshot()) !== before) crashes.push(`#${i} changed the data although refused`)
        } else {
          crashes.push(`#${i} ${(e as Error)?.constructor?.name}: ${(e as Error)?.message?.slice(0, 80)}`)
          if ((await snapshot()) !== before) crashes.push(`#${i} left the data half-changed after a crash`)
        }
      }
    }
    expect(crashes.slice(0, 8)).toEqual([])
    expect(refused).toBeGreaterThan(20) // the damage is really being noticed
    expect(accepted).toBeGreaterThan(20) // and harmless changes (an unknown field, an empty table) do not stop an import
  }, 120_000)

  it('the untouched backup imports and exports back the same', async () => {
    await resetDb()
    await importBackup(original, { mode: 'replace' })
    const again = JSON.parse(JSON.stringify(await exportBackup()))
    delete again.exportedAt
    delete again.settings // importing opens the app on its home screen: a settings row is made if there was none
    const first = { ...original } as Record<string, unknown>
    delete first.exportedAt
    delete first.settings
    expect(again).toEqual(first)
  })
})
