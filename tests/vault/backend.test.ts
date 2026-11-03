import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The backend keeps module state, so every test gets a fresh copy of it. */
async function freshBackend(hint: boolean) {
  vi.resetModules()
  localStorage.clear()
  if (hint) localStorage.setItem('x.vault', '1')
  const backend = await import('@/vault/backend')
  backend.initBackend('x.vault')
  return backend
}
const names = async () => (await indexedDB.databases()).map(d => d.name)
let n = 0
const dbName = () => `backend-test-${++n}-${Math.random().toString(36).slice(2)}`

afterEach(() => { localStorage.clear() })

describe('the storage backend', () => {
  it('is the browser\'s own unless encryption is hinted to be on', async () => {
    const b = await freshBackend(false)
    expect(b.backendKind()).toBe('native')
    const name = dbName()
    const db = new Dexie(name, { indexedDB: b.backendFactory, IDBKeyRange: b.backendKeyRange })
    db.version(1).stores({ t: 'id' })
    await db.table('t').put({ id: 1 })
    expect(await names()).toContain(name)
  })

  it('while encryption is on, an early open waits instead of creating a plain database', async () => {
    const b = await freshBackend(true)
    expect(b.backendKind()).toBe('pending')
    const name = dbName()
    const db = new Dexie(name, { indexedDB: b.backendFactory, IDBKeyRange: b.backendKeyRange })
    db.version(1).stores({ t: 'id' })
    // something imports a module that reads a setting at once, long before the vault is unlocked
    const early = db.table('t').put({ id: 1, secret: 'Ольга' }).then(() => 'done')
    await new Promise(r => setTimeout(r, 150))
    expect(await names()).not.toContain(name) // nothing was created on disk
    expect(await Promise.race([early, Promise.resolve('waiting')])).toBe('waiting')

    // the vault unlocks and picks the memory backend: the waiting write lands there, not on disk
    await b.selectMemoryBackend()
    expect(await early).toBe('done')
    expect(await db.table('t').get(1)).toMatchObject({ secret: 'Ольга' })
    expect(await names()).not.toContain(name)
  })

  it('a stale hint (encryption is off after all) is released by the gate choosing the native backend', async () => {
    const b = await freshBackend(true)
    const name = dbName()
    const db = new Dexie(name, { indexedDB: b.backendFactory, IDBKeyRange: b.backendKeyRange })
    db.version(1).stores({ t: 'id' })
    const early = db.table('t').put({ id: 1 }).then(() => 'done')
    b.selectNativeBackend()
    expect(await early).toBe('done')
    expect(await names()).toContain(name)
  })

  it('journalExists answers without creating anything', async () => {
    const b = await freshBackend(false)
    const name = dbName()
    expect(await b.journalExists(name)).toBe(false)
    expect(await names()).not.toContain(name)
  })
})

beforeEach(() => { vi.restoreAllMocks() })
