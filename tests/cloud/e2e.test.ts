import { beforeEach, describe, expect, it } from 'vitest'
import { E2ELockedError } from '@/cloud/engine'
import { importCloudKey, isEnvelope, makeCloudKey, openRecord, sealRecord, CLOUD_KEY_PURPOSE } from '@/cloud/e2e'
import { finishJoin, readJoinRequest, startJoin } from '@/crypto/pairing'
import { toBase64 } from '@/crypto/bytes'
import { FakeServer, makeDevice, until, type Device } from './fake'
import { personOf } from './rows'

const sync = (d: Device, s: FakeServer, opts?: { full?: boolean }) => d.engine.syncOnce(s.remote(), opts)
const giveKey = async (d: Device, raw: Uint8Array) => { await d.db.settings.put({ id: 'me', name: '', onboarded: true, createdAt: 1, e2e: { key: toBase64(raw), id: (await importCloudKey(raw)).id } }) }
const wholeServer = (s: FakeServer) => JSON.stringify([...s.rows.values()].map(r => r.data))

let key: Uint8Array
beforeEach(async () => { key = (await makeCloudKey()).raw })

describe('records on the server are sealed', () => {
  it('the server holds only envelopes: no name, no note, nothing readable', async () => {
    const a = makeDevice(); const s = new FakeServer()
    await giveKey(a, key)
    await a.db.people.add(personOf('p1', { firstName: 'Ольга', notes: 'любит чай и джаз' }))
    await sync(a, s)
    const row = s.get('people', 'p1')!
    expect(isEnvelope(row.data)).toBe(true)
    expect(wholeServer(s)).not.toContain('Ольга')
    expect(wholeServer(s)).not.toContain('джаз')
    expect(wholeServer(s)).not.toContain(toBase64(key)) // and the key itself never goes there, not even sealed in a settings row
    expect(row.client_ts).toBeGreaterThan(0) // what the server needs to order edits is still in the clear
  })

  it('another device with the key reads everything, and edits keep merging field by field', async () => {
    const a = makeDevice(); const b = makeDevice(); const s = new FakeServer()
    await giveKey(a, key); await giveKey(b, key)
    await a.db.people.add(personOf('p1', { notes: 'v1', company: 'Acme', city: 'Москва' }))
    await sync(a, s); await sync(b, s)
    expect((await b.db.people.get('p1'))?.company).toBe('Acme')
    for (const [d, change] of [[a, { company: 'Globex' }], [b, { city: 'Лиссабон' }]] as const) {
      await new Promise(r => setTimeout(r, 5))
      await d.db.people.update('p1', change)
      await until(async () => (await d.db.outbox.get('people:p1'))?.base !== undefined)
    }
    for (let i = 0; i < 3; i++) for (const d of [a, b]) await sync(d, s)
    for (const d of [a, b]) expect(await d.db.people.get('p1')).toMatchObject({ company: 'Globex', city: 'Лиссабон', notes: 'v1' })
    expect(wholeServer(s)).not.toContain('Globex')
  })

  it('a deletion still works', async () => {
    const a = makeDevice(); const b = makeDevice(); const s = new FakeServer()
    await giveKey(a, key); await giveKey(b, key)
    await a.db.people.add(personOf('p1')); await sync(a, s); await sync(b, s)
    await a.db.people.delete('p1'); await until(async () => (await a.db.outbox.count()) > 0)
    await sync(a, s); await sync(b, s)
    expect(await b.db.people.get('p1')).toBeUndefined()
  })
})

describe('turning it on for an account that already has plain data', () => {
  it('re-sends everything sealed with fresh stamps, so no plain copy is left on the server', async () => {
    const a = makeDevice(); const s = new FakeServer()
    await a.db.people.bulkAdd([personOf('p1', { firstName: 'Ольга' }), personOf('p2', { firstName: 'Игорь' })])
    await sync(a, s)
    expect(wholeServer(s)).toContain('Ольга') // plain until now
    await giveKey(a, key)
    await a.engine.enqueueAll({ fresh: true })
    await sync(a, s)
    expect(wholeServer(s)).not.toContain('Ольга')
    expect(wholeServer(s)).not.toContain('Игорь')
    expect([...s.rows.values()].every(r => r.deleted || isEnvelope(r.data))).toBe(true)
    // and the old way, with the stamps the rows had, would have left the plain copies behind
    const b = makeDevice(); const s2 = new FakeServer()
    await b.db.people.add(personOf('p1', { firstName: 'Ольга' })); await sync(b, s2)
    await giveKey(b, key); await b.engine.enqueueAll(); await sync(b, s2)
    expect(wholeServer(s2)).toContain('Ольга')
  })
})

describe('a device without the key', () => {
  async function sealedServer() {
    const a = makeDevice(); const s = new FakeServer()
    await giveKey(a, key)
    await a.db.people.add(personOf('p1', { firstName: 'Ольга' }))
    await sync(a, s)
    return { a, s }
  }

  it('reads nothing, shows nothing wrong, and sends nothing (it would put plain data next to sealed data)', async () => {
    const { s } = await sealedServer()
    const b = makeDevice()
    await b.db.people.add(personOf('mine', { firstName: 'Локальный' }))
    await b.engine.enqueueAll()
    await expect(sync(b, s)).rejects.toBeInstanceOf(E2ELockedError)
    expect(await b.engine.e2eState()).toBe('locked')
    expect(await b.db.people.get('p1')).toBeUndefined()
    expect(wholeServer(s)).not.toContain('Локальный')
    expect(s.get('people', 'mine')).toBeUndefined()
  })

  it('joins through the quantum-safe exchange and then reads everything', async () => {
    const { a, s } = await sealedServer()
    const b = makeDevice()
    await expect(sync(b, s)).rejects.toBeInstanceOf(E2ELockedError)

    const request = await startJoin() // on the new device
    const old = await readJoinRequest(request.code) // on the old one, after the person confirms the digits
    expect(old.checkDigits).toBe(request.checkDigits)
    const answer = await old.seal(key as Uint8Array<ArrayBuffer>, CLOUD_KEY_PURPOSE)
    const got = await finishJoin(request, answer, CLOUD_KEY_PURPOSE)
    expect(toBase64(got)).toBe(toBase64(key))

    await giveKey(b, got)
    await b.engine.delMeta('cursor'); await b.engine.delMeta('e2eMismatch')
    await sync(b, s)
    expect((await b.db.people.get('p1'))?.firstName).toBe('Ольга')
    expect(await b.engine.e2eState()).toBe('on')
    expect(a).toBeDefined()
  })

  it('a device with a different key is told so and sends nothing', async () => {
    const { s } = await sealedServer()
    const c = makeDevice()
    await giveKey(c, (await makeCloudKey()).raw)
    await expect(sync(c, s)).rejects.toBeInstanceOf(E2ELockedError)
    expect(await c.engine.e2eState()).toBe('locked')
    expect(await c.db.people.get('p1')).toBeUndefined()
  })
})

describe('the envelope', () => {
  it('opens only with its key, and only in its own place', async () => {
    const k = await importCloudKey(key)
    const other = await importCloudKey((await makeCloudKey()).raw)
    const env = await sealRecord(k, 'people', 'p1', { id: 'p1', firstName: 'Ольга' })
    expect(await openRecord(k, 'people', 'p1', env)).toMatchObject({ firstName: 'Ольга' })
    expect(await openRecord(other, 'people', 'p1', env)).toBeNull()
    expect(await openRecord(k, 'people', 'p2', env)).toBeNull() // a record moved to another row does not open
    expect(await openRecord(k, 'interactions', 'p1', env)).toBeNull()
    expect(await openRecord(k, 'people', 'p1', { ...env, c: env.c.slice(0, -4) + 'AAAA' })).toBeNull()
  })

  it('every seal differs, even for the same record', async () => {
    const k = await importCloudKey(key)
    const a = await sealRecord(k, 'people', 'p1', { x: 1 }); const b = await sealRecord(k, 'people', 'p1', { x: 1 })
    expect(a.iv).not.toBe(b.iv); expect(a.c).not.toBe(b.c)
  })
})

