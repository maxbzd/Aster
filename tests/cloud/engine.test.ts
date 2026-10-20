import { describe, expect, it } from 'vitest'
import { PULL_OVERLAP, PULL_PAGE, PUSH_BATCH, serialize, stable, type RemoteRecord } from '@/cloud/engine'
import { FakeServer, makeDevice, outboxKeys, settle, until, type Device } from './fake'
import { circleOf, personOf } from './rows'

const sync = (d: Device, s: FakeServer, opts?: { full?: boolean }) => d.engine.syncOnce(s.remote(), opts)

describe('tracking changes', () => {
  it('create, update and delete get into the queue as one entry per row', async () => {
    const d = makeDevice()
    await d.db.people.add(personOf('p1'))
    await until(async () => (await outboxKeys(d)).includes('people:p1'))
    const first = (await d.db.outbox.get('people:p1'))!.ts

    await d.db.people.update('p1', { notes: 'правка' })
    await until(async () => (await d.db.outbox.get('people:p1'))!.ts > first)
    expect(await outboxKeys(d)).toEqual(['people:p1'])

    await d.db.people.delete('p1')
    await settle(d)
    expect(await outboxKeys(d)).toEqual(['people:p1'])
  })

  it('works when the transaction does not include the queue table', async () => {
    const d = makeDevice()
    await d.db.transaction('rw', d.db.people, async () => { await d.db.people.put(personOf('p1')) })
    await until(async () => (await d.db.outbox.count()) === 1)
  })

  it('bulk operations: bulkPut, bulkDelete, clear', async () => {
    const d = makeDevice()
    await d.db.people.bulkPut([personOf('a'), personOf('b'), personOf('c')])
    await until(async () => (await d.db.outbox.count()) === 3)
    await d.db.outbox.clear()
    await d.db.people.bulkDelete(['a', 'b'])
    await until(async () => (await outboxKeys(d)).join() === 'people:a,people:b')
    await d.db.outbox.clear()
    await d.db.people.clear()
    await until(async () => (await outboxKeys(d)).join() === 'people:c')
  })

  it('changes that came from the cloud are not sent back', async () => {
    const d = makeDevice()
    const rec: RemoteRecord = { tbl: 'people', id: 'r1', data: { ...personOf('r1') }, deleted: false, client_ts: 5, seq: 1 }
    await d.engine.applyRemote([rec])
    await settle(d)
    expect(await d.db.people.get('r1')).toBeDefined()
    expect(await d.db.outbox.count()).toBe(0)
  })

  it('an edit of local-only settings fields (Astra\'s key, the backup date) does not go to the cloud', async () => {
    const d = makeDevice()
    await d.db.settings.add({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1 })
    await until(async () => (await d.db.outbox.count()) === 1)
    await d.db.outbox.clear()

    await d.db.settings.update('me', { ai: { mode: 'key', apiKey: 'sk-секрет', model: 'm', shareNotes: false, webSearch: false } })
    await d.db.settings.update('me', { lastBackupAt: 123, backupSnoozeUntil: 5 })
    await settle(d)
    expect(await d.db.outbox.count()).toBe(0)

    await d.db.settings.update('me', { name: 'Максим' })
    await until(async () => (await d.db.outbox.count()) === 1)
  })
})

describe('sending', () => {
  it('a row goes whole with the timestamp from the queue, the queue is cleared', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.people.add(personOf('p1', { firstName: 'Анна' }))
    await d.db.circles.add(circleOf('c1'))
    await until(async () => (await d.db.outbox.count()) === 2)
    const ts = (await d.db.outbox.get('people:p1'))!.ts

    const { pushed } = await d.engine.pushPending(s.remote())
    expect(pushed).toBe(2)
    expect(s.get('people', 'p1')).toMatchObject({ deleted: false, client_ts: ts, data: { id: 'p1', firstName: 'Анна' } })
    expect(await d.db.outbox.count()).toBe(0)
  })

  it('a deleted row goes as a tombstone with no data', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.people.add(personOf('p1'))
    await d.engine.pushPending(s.remote())
    await d.db.people.delete('p1')
    await until(async () => (await d.db.outbox.count()) === 1)
    await d.engine.pushPending(s.remote())
    expect(s.get('people', 'p1')).toMatchObject({ deleted: true, data: null })
  })

  it('Astra\'s keys and the backup date do not get into the payload', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.settings.add({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1, lastBackupAt: 9, ai: { mode: 'key', apiKey: 'sk-секрет', model: 'm', shareNotes: false, webSearch: false } })
    await d.engine.pushPending(s.remote())
    const sent = JSON.stringify(s.pushes)
    expect(sent).not.toContain('sk-секрет')
    expect(sent).not.toContain('lastBackupAt')
    expect(s.get('settings', 'me')?.data).toMatchObject({ name: 'Макс', onboarded: true })
    expect(serialize('settings', { id: 'me', ai: { apiKey: 'x' }, name: 'a' })).toEqual({ id: 'me', name: 'a' })
  })

  it('a large queue is split into batches', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.people.bulkAdd(Array.from({ length: 250 }, (_, i) => personOf(`p${i}`)))
    await until(async () => (await d.db.outbox.count()) === 250)
    await d.engine.pushPending(s.remote())
    expect(s.pushes.map(p => p.length)).toEqual([PUSH_BATCH, PUSH_BATCH, 50])
    expect(s.live('people')).toHaveLength(250)
  })

  it('on an error nothing is lost, a retry sends the rest', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.people.bulkAdd([personOf('a'), personOf('b')])
    await until(async () => (await d.db.outbox.count()) === 2)
    s.failNext = 1
    await expect(d.engine.pushPending(s.remote())).rejects.toThrow('boom')
    expect(await d.db.outbox.count()).toBe(2)
    await d.engine.pushPending(s.remote())
    expect(await d.db.outbox.count()).toBe(0)
    expect(s.live('people')).toHaveLength(2)
  })

  it('if a row was changed during sending, the edit is not lost and goes in the next batch', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.people.add(personOf('p1'))
    await until(async () => (await d.db.outbox.count()) === 1)
    const before = (await d.db.outbox.get('people:p1'))!.ts
    const inner = s.remote()
    let calls = 0
    await d.engine.pushPending({
      ...inner,
      push: async rows => {
        const res = await inner.push(rows)
        if (++calls === 1) {
          await d.db.people.update('p1', { notes: 'во время отправки' })
          await until(async () => (await d.db.outbox.get('people:p1'))!.ts > before)
        }
        return res
      },
    })
    expect(calls).toBe(2)
    expect(await d.db.outbox.count()).toBe(0)
    expect(s.get('people', 'p1')?.data).toMatchObject({ notes: 'во время отправки' })
  })
})

describe('receiving', () => {
  it('new rows, edits and deletions are applied; applying again changes nothing', async () => {
    const a = makeDevice()
    const b = makeDevice()
    const s = new FakeServer()
    await a.db.people.add(personOf('p1', { firstName: 'Анна' }))
    await sync(a, s)
    expect(await sync(b, s)).toMatchObject({ pulled: 1 })
    expect((await b.db.people.get('p1'))?.firstName).toBe('Анна')
    expect((await sync(b, s)).pulled).toBe(0)

    await a.db.people.update('p1', { firstName: 'Анна-Мария' })
    await until(async () => (await a.db.outbox.count()) === 1)
    await sync(a, s)
    await sync(b, s)
    expect((await b.db.people.get('p1'))?.firstName).toBe('Анна-Мария')

    await a.db.people.delete('p1')
    await until(async () => (await a.db.outbox.count()) === 1)
    await sync(a, s)
    await sync(b, s)
    expect(await b.db.people.get('p1')).toBeUndefined()
    expect(await b.db.outbox.count()).toBe(0)
  })

  it('your own unsynced edit is newer: the cloud does not overwrite it and it goes out afterwards', async () => {
    const a = makeDevice()
    const b = makeDevice()
    const s = new FakeServer()
    await a.db.people.add(personOf('p1', { notes: 'v1' }))
    await sync(a, s)
    await sync(b, s)
    await a.db.people.update('p1', { notes: 'от A' })
    await until(async () => (await a.db.outbox.count()) === 1)
    await sync(a, s)
    // B edits later but has not synced yet
    await new Promise(r => setTimeout(r, 5))
    await b.db.people.update('p1', { notes: 'от B (позже)' })
    await until(async () => (await b.db.outbox.count()) === 1)
    await sync(b, s)
    expect((await b.db.people.get('p1'))?.notes).toBe('от B (позже)')
    expect(s.get('people', 'p1')?.data).toMatchObject({ notes: 'от B (позже)' })
    await sync(a, s)
    expect((await a.db.people.get('p1'))?.notes).toBe('от B (позже)')
  })

  it('a cloud version newer than the local unsynced one: the cloud wins', async () => {
    const a = makeDevice()
    const b = makeDevice()
    const s = new FakeServer()
    await a.db.people.add(personOf('p1', { notes: 'v1' }))
    await sync(a, s)
    await sync(b, s)
    await b.db.people.update('p1', { notes: 'старая правка B, офлайн' })
    await until(async () => (await b.db.outbox.count()) === 1)
    await new Promise(r => setTimeout(r, 5))
    await a.db.people.update('p1', { notes: 'новая правка A' })
    await until(async () => (await a.db.outbox.count()) === 1)
    await sync(a, s)
    await sync(b, s)
    expect((await b.db.people.get('p1'))?.notes).toBe('новая правка A')
    expect(await b.db.outbox.count()).toBe(0)
  })

  it('settings arrive without losing Astra\'s key, which exists only on this device', async () => {
    const a = makeDevice()
    const b = makeDevice()
    const s = new FakeServer()
    await a.db.settings.add({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1 })
    await sync(a, s)
    await b.db.settings.add({ id: 'me', name: 'Старое', onboarded: true, createdAt: 0, lastBackupAt: 77, ai: { mode: 'key', apiKey: 'sk-b', model: 'm', shareNotes: false, webSearch: false } })
    await b.db.outbox.clear()
    await sync(b, s)
    const me = await b.db.settings.get('me')
    expect(me).toMatchObject({ name: 'Макс', lastBackupAt: 77, ai: { apiKey: 'sk-b' } })
    expect(await b.db.outbox.count()).toBe(0)
  })

  it('reading by pages: more than one page at a time', async () => {
    const a = makeDevice()
    const b = makeDevice()
    const s = new FakeServer()
    const total = PULL_PAGE * 2 + 37
    await a.db.interactions.bulkAdd(Array.from({ length: total }, (_, i) => ({ id: `i${i}`, personIds: [], type: 'note' as const, date: i, createdAt: i })))
    await until(async () => (await a.db.outbox.count()) === total)
    await sync(a, s)
    await sync(b, s)
    expect(await b.db.interactions.count()).toBe(total)
    expect(s.pulls.filter(p => p.after < PULL_PAGE).length).toBeGreaterThan(1)
  })

  it('the cursor steps back by PULL_OVERLAP so as not to miss what was committed late', async () => {
    const a = makeDevice()
    const s = new FakeServer()
    for (let i = 0; i < 400; i++) s.rows.set(`people:x${i}`, { tbl: 'people', id: `x${i}`, data: { ...personOf(`x${i}`) }, deleted: false, client_ts: 1, seq: ++s.seq })
    await sync(a, s)
    expect(await a.engine.getMeta('cursor')).toBe(400)
    s.pulls.length = 0
    await sync(a, s)
    expect(s.pulls[0].after).toBe(400 - PULL_OVERLAP)
  })

  it('a record that was committed to the cloud later and with a smaller seq is not lost', async () => {
    const a = makeDevice()
    const s = new FakeServer()
    s.rows.set('people:late', { tbl: 'people', id: 'late', data: { ...personOf('late') }, deleted: false, client_ts: 1, seq: 5 })
    s.rows.set('people:early', { tbl: 'people', id: 'early', data: { ...personOf('early') }, deleted: false, client_ts: 1, seq: 9 })
    // "late" was not visible yet (its transaction is not committed)
    const hidden = s.rows.get('people:late')!
    s.rows.delete('people:late')
    await sync(a, s)
    s.rows.set('people:late', hidden)
    await sync(a, s)
    expect(await a.db.people.get('late')).toBeDefined()
  })

  it('records of unknown tables are ignored', async () => {
    const a = makeDevice()
    const n = await a.engine.applyRemote([{ tbl: 'hack' as never, id: 'x', data: { id: 'x' }, deleted: false, client_ts: 1, seq: 1 }])
    expect(n).toBe(0)
  })
})

describe('several devices', () => {
  it('converge under concurrent edits: the later one wins, in any order of syncing', async () => {
    for (const order of ['ab', 'ba'] as const) {
      const a = makeDevice()
      const b = makeDevice()
      const s = new FakeServer()
      await a.db.people.add(personOf('p1', { notes: 'v1' }))
      await sync(a, s)
      await sync(b, s)
      await a.db.people.update('p1', { notes: 'A' })
      await until(async () => (await a.db.outbox.count()) === 1)
      await new Promise(r => setTimeout(r, 5))
      await b.db.people.update('p1', { notes: 'B позже' })
      await until(async () => (await b.db.outbox.count()) === 1)
      for (const x of order) { await sync(x === 'a' ? a : b, s) }
      for (const x of order) { await sync(x === 'a' ? a : b, s) }
      expect((await a.db.people.get('p1'))?.notes).toBe('B позже')
      expect((await b.db.people.get('p1'))?.notes).toBe('B позже')
    }
  })

  it('first connection: local data and the cloud are merged, nothing is lost', async () => {
    const a = makeDevice()
    const b = makeDevice()
    const s = new FakeServer()
    await a.db.people.bulkAdd([personOf('a1'), personOf('a2')])
    await a.engine.enqueueAll()
    await sync(a, s)
    // B had its own data before signing in
    await b.db.people.bulkAdd([personOf('b1')])
    await b.engine.enqueueAll()
    await sync(b, s)
    await sync(a, s)
    const ids = async (d: Device) => (await d.db.people.toArray()).map(p => p.id).sort()
    expect(await ids(a)).toEqual(['a1', 'a2', 'b1'])
    expect(await ids(b)).toEqual(['a1', 'a2', 'b1'])
  })

  it('an old local copy does not resurrect what was deleted in the cloud', async () => {
    const a = makeDevice()
    const b = makeDevice()
    const s = new FakeServer()
    await a.db.people.add(personOf('p1', { updatedAt: 1000 }))
    await sync(a, s)
    await sync(b, s)
    await a.db.people.delete('p1')
    await until(async () => (await a.db.outbox.count()) === 1)
    await sync(a, s)
    // B did not sync and queues everything again with the original stamps
    await b.engine.enqueueAll()
    await sync(b, s)
    expect(await b.db.people.get('p1')).toBeUndefined()
    expect(s.get('people', 'p1')?.deleted).toBe(true)
  })

  it('a full resync repairs a cloud that lost rows', async () => {
    const a = makeDevice()
    const s = new FakeServer()
    await a.db.people.bulkAdd([personOf('p1'), personOf('p2')])
    await sync(a, s)
    s.rows.clear()
    await a.engine.enqueueAll()
    await sync(a, s, { full: true })
    expect(s.live('people').map(r => r.id).sort()).toEqual(['p1', 'p2'])
  })

  it('an overall check: random operations on three devices, after syncing all are equal', async () => {
    let seed = 20261009
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const devs = [makeDevice('x'), makeDevice('y'), makeDevice('z')]
    const s = new FakeServer()
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`)

    for (let round = 0; round < 12; round++) {
      for (const d of devs) {
        for (let k = 0; k < 4; k++) {
          const id = ids[Math.floor(rnd() * ids.length)]
          const op = rnd()
          await new Promise(r => setTimeout(r, 2))
          if (op < 0.55) await d.db.people.put(personOf(id, { notes: `${d.name}-${round}-${k}`, updatedAt: Date.now() }))
          else if (op < 0.8) await d.db.people.update(id, { notes: `upd-${d.name}-${round}` })
          else await d.db.people.delete(id)
        }
      }
      await Promise.all(devs.map(d => settle(d)))
      // not all of them sync, and not in the same order
      for (const d of devs.filter(() => rnd() < 0.7)) await sync(d, s)
    }
    for (let pass = 0; pass < 3; pass++) for (const d of devs) await sync(d, s)

    const snap = async (d: Device) => stable((await d.db.people.toArray()).sort((p, q) => (p.id < q.id ? -1 : 1)))
    const server = stable(s.live('people').map(r => r.data).sort((p, q) => (String((p as { id: string }).id) < String((q as { id: string }).id) ? -1 : 1)))
    const [sx, sy, sz] = await Promise.all(devs.map(snap))
    expect(sy).toBe(sx)
    expect(sz).toBe(sx)
    expect(sx).toBe(server)
    for (const d of devs) expect(await d.db.outbox.count()).toBe(0)
  })
})

describe('stable', () => {
  it('does not depend on key order and ignores undefined', () => {
    expect(stable({ b: 1, a: [{ d: 1, c: undefined }] })).toBe(stable({ a: [{ d: 1 }], b: 1 }))
    expect(stable({ a: 1 })).not.toBe(stable({ a: 2 }))
  })
})

describe('a record the server rejects for good', () => {
  it('does not block the others: the batch is split, the culprit is set aside, the rest goes through', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.people.bulkAdd([personOf('a'), personOf('bad'), personOf('c'), personOf('d')])
    await until(async () => (await d.db.outbox.count()) === 4)
    s.poison.add('bad')
    const { pushed } = await d.engine.pushPending(s.remote())
    expect(pushed).toBe(3)
    expect(s.live('people').map(r => r.id).sort()).toEqual(['a', 'c', 'd'])
    expect(await d.db.outbox.count()).toBe(0)
    expect(await d.engine.rejectedCount()).toBe(1)
  })

  it('an ordinary network failure still leaves everything in the queue and sets nothing aside', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.people.add(personOf('a'))
    await until(async () => (await d.db.outbox.count()) === 1)
    s.online = false
    await expect(d.engine.pushPending(s.remote())).rejects.toThrow('Failed to fetch')
    expect(await d.db.outbox.count()).toBe(1)
    expect(await d.engine.rejectedCount()).toBe(0)
  })

  it('a corrected record goes later, and the rejected counter decreases', async () => {
    const d = makeDevice()
    const s = new FakeServer()
    await d.db.people.add(personOf('bad'))
    await until(async () => (await d.db.outbox.count()) === 1)
    s.poison.add('bad')
    await d.engine.pushPending(s.remote())
    expect(await d.engine.rejectedCount()).toBe(1)
    s.poison.clear()
    await d.db.people.update('bad', { notes: 'исправлено' })
    await until(async () => (await d.db.outbox.count()) === 1)
    await d.engine.pushPending(s.remote())
    expect(await d.engine.rejectedCount()).toBe(0)
    expect(s.get('people', 'bad')).toBeDefined()
  })
})

describe('the device clock', () => {
  it('a device with a clock years ahead does not block edits from a normal clock', async () => {
    const wrong = makeDevice()
    const right = makeDevice()
    const s = new FakeServer()
    await wrong.db.people.add(personOf('p1', { notes: 'с неверных часов' }))
    await wrong.db.outbox.put({ key: 'people:p1', table: 'people', rowId: 'p1', ts: Date.now() + 10 * 365 * 86_400_000 })
    await wrong.engine.syncOnce(s.remote())
    await right.engine.syncOnce(s.remote())
    expect((await right.db.people.get('p1'))?.notes).toBe('с неверных часов')

    // two minutes later the edit from the normal device wins
    const later = Date.now() + 120_000
    s.nowMs = () => later
    await right.db.people.update('p1', { notes: 'нормальная правка' })
    await right.db.outbox.put({ key: 'people:p1', table: 'people', rowId: 'p1', ts: later })
    await right.engine.syncOnce(s.remote())
    expect(s.get('people', 'p1')?.data).toMatchObject({ notes: 'нормальная правка' })
  })
})
