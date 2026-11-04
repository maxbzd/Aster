import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsterDB } from '@/data/db'
import { backendFactory, backendKeyRange, selectNativeBackend } from '@/vault/backend'
import { openJournal, slot } from '@/vault/store'
import { createVaultRuntime, throttleSeconds, useVaultState } from '@/vault/session'
import { personOf } from '../cloud/rows'

const argon2 = { m: 64, t: 1, p: 1 }
let n = 0
const fresh = () => `vault-test-${++n}-${Math.random().toString(36).slice(2)}`

/** One "page load": a database, a runtime, and a reload that only records that it was asked for. */
function load(name: string) {
  const db = new AsterDB(name, { indexedDB: backendFactory, IDBKeyRange: backendKeyRange })
  const reload = vi.fn()
  const vault = createVaultRuntime({ app: 'aster', db, journalName: `${name}-vault`, reload })
  return { db, vault, reload, name }
}
const databases = async () => (await indexedDB.databases()).map(d => d.name)
const settle = () => new Promise(r => setTimeout(r, 120))

async function journalBytes(name: string): Promise<string> {
  const j = await openJournal(indexedDB, `${name}-vault`)
  const parts: string[] = []
  await j.eachRow((k, b) => { parts.push(k, new TextDecoder('latin1').decode(b)) })
  parts.push(JSON.stringify(await j.header()))
  j.close()
  return parts.join('\n')
}

/** Turns encryption on for a database that already has people in it, then "reloads". */
async function enabled(name: string, password = 'пароль-для-теста') {
  const first = load(name)
  await first.vault.boot()
  await first.db.people.bulkAdd([personOf('p1', { firstName: 'Ольга', notes: 'любит чай' }), personOf('p2', { firstName: 'Игорь' })])
  await first.db.settings.put({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1 })
  const prepared = await first.vault.prepare(password, argon2)
  await prepared.commit()
  return { first, prepared, password }
}

beforeEach(() => { selectNativeBackend(); useVaultState.setState({ state: 'checking', busy: false }); localStorage.clear() })

describe('turning encryption on', () => {
  it('writes only sealed records: no name, note or id is readable on disk', async () => {
    const name = fresh()
    const first = load(name)
    await first.vault.boot()
    await first.db.people.add(personOf('secret-id-42', { firstName: 'Ольга', lastName: 'Соколова', notes: 'любит чай и джаз' }))
    const prepared = await first.vault.prepare('пароль-для-теста', argon2)
    const text = await journalBytes(name)
    for (const needle of ['Ольга', 'Соколова', 'любит чай', 'jazz', 'пароль-для-теста']) expect(text).not.toContain(needle)
    // the key of a record shows the table and the row's key, nothing else
    expect(text).toContain(slot('people', 'secret-id-42'))
    expect(prepared.recoveryKey).toMatch(/^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/)
    await prepared.abort()
  })

  it('leaves the plain database alone until the recovery key is saved, and abort changes nothing', async () => {
    const name = fresh()
    const first = load(name)
    await first.vault.boot()
    await first.db.people.add(personOf('p1'))
    const prepared = await first.vault.prepare('пароль-для-теста', argon2)
    expect(await databases()).toContain(name)
    await prepared.abort()
    expect(await databases()).not.toContain(`${name}-vault`)
    expect(await first.db.people.count()).toBe(1)
    expect(first.reload).not.toHaveBeenCalled()
  })

  it('commit deletes the plain database and reloads; the next load is locked, with no readable copy anywhere', async () => {
    const name = fresh()
    const { first } = await enabled(name)
    expect(first.reload).toHaveBeenCalledTimes(1)
    expect(await databases()).not.toContain(name)
    const second = load(name)
    expect(await second.vault.boot()).toBe('locked')
    expect(await databases()).not.toContain(name) // booting did not recreate it
  })

  it('refuses to start twice', async () => {
    const name = fresh()
    const { second } = await enabled(name).then(async () => { const s = load(name); await s.vault.boot(); return { second: s } })
    await expect(second.vault.prepare('x'.repeat(8), argon2)).rejects.toThrow()
  })
})

describe('unlocking', () => {
  it('a wrong password is refused and slows down; the right one opens everything', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    expect(await s.vault.unlock({ kind: 'password', password: 'не тот' })).toBe('wrong')
    expect(await s.vault.unlock({ kind: 'password', password: 'и не этот' })).toBe('wrong')
    expect(await s.vault.unlock({ kind: 'password', password: 'третий' })).toBe('wrong')
    expect(await s.vault.unlock({ kind: 'password', password })).toBe('wait') // three in a row: the delay starts
    expect(s.vault.secondsUntilRetry()).toBeGreaterThan(0)
    expect(await s.vault.unlock({ kind: 'password', password }, Date.now() + 5000)).toBe('ok')
    expect(useVaultState.getState().state).toBe('unlocked')
    expect((await s.db.people.get('p1'))?.notes).toBe('любит чай')
    expect(await s.db.people.count()).toBe(2)
    expect((await s.db.settings.get('me'))?.name).toBe('Макс')
    expect(await databases()).not.toContain(name) // the data is in memory; no plain database on disk
    expect(s.vault.secondsUntilRetry()).toBe(0)
  })

  it('throttling follows 0, 0, 2, 4, 8 … 60 seconds', () => {
    expect([1, 2, 3, 4, 5, 9, 20].map(throttleSeconds)).toEqual([0, 0, 2, 4, 8, 60, 60])
  })

  it('the recovery key opens it, a typo does not, and a new password does not need the old one', async () => {
    const name = fresh()
    const first = load(name)
    await first.vault.boot()
    await first.db.people.add(personOf('p1'))
    const prepared = await first.vault.prepare('пароль-для-теста', argon2)
    await prepared.commit()

    const s = load(name)
    await s.vault.boot()
    const typo = prepared.recoveryKey.replace(/.$/, c => (c === '0' ? '1' : '0'))
    expect(await s.vault.unlock({ kind: 'recovery', key: typo })).toBe('wrong')
    expect(await s.vault.unlock({ kind: 'recovery', key: prepared.recoveryKey.toLowerCase().replaceAll('-', ' ') }, Date.now() + 120_000)).toBe('ok')
    await s.vault.changePassword('новый-пароль-1', argon2)

    const t = load(name)
    await t.vault.boot()
    expect(await t.vault.unlock({ kind: 'password', password: 'пароль-для-теста' })).toBe('wrong')
    expect(await t.vault.unlock({ kind: 'password', password: 'новый-пароль-1' }, Date.now() + 120_000)).toBe('ok')
    expect(await t.db.people.count()).toBe(1)
  })

  it('a new recovery key replaces the old one', async () => {
    const name = fresh()
    const { password, prepared } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await s.vault.unlock({ kind: 'password', password })
    const next = await s.vault.renewRecoveryKey()
    expect(next).not.toBe(prepared.recoveryKey)
    const t = load(name)
    await t.vault.boot()
    expect(await t.vault.unlock({ kind: 'recovery', key: prepared.recoveryKey })).toBe('wrong')
    expect(await t.vault.unlock({ kind: 'recovery', key: next }, Date.now() + 120_000)).toBe('ok')
  })

  it('a passkey secret opens it, and only the secret that belongs to that passkey', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await s.vault.unlock({ kind: 'password', password })
    const secret = crypto.getRandomValues(new Uint8Array(32))
    await s.vault.addPasskey('cred-1', crypto.getRandomValues(new Uint8Array(32)), secret, 'Телефон')
    const t = load(name)
    await t.vault.boot()
    expect(await t.vault.unlock({ kind: 'passkey', credentialId: 'cred-1', secret: crypto.getRandomValues(new Uint8Array(32)) })).toBe('wrong')
    expect(await t.vault.unlock({ kind: 'passkey', credentialId: 'cred-1', secret }, Date.now() + 120_000)).toBe('ok')
    await t.vault.removePasskey('cred-1')
    const u = load(name)
    await u.vault.boot()
    expect(await u.vault.unlock({ kind: 'passkey', credentialId: 'cred-1', secret }, Date.now() + 240_000)).toBe('error') // no such passkey any more
  })
})

describe('keeping the journal up to date while unlocked', () => {
  it('every kind of change reaches the disk, and survives a reload', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await s.vault.unlock({ kind: 'password', password })

    await s.db.people.add(personOf('p3', { firstName: 'Нина' }))        // create
    await s.db.people.update('p1', { notes: 'теперь любит кофе' })        // update
    await s.db.people.delete('p2')                                         // delete
    await s.db.people.bulkPut([personOf('p4', { firstName: 'Лев' }), personOf('p5', { firstName: 'Ева' })]) // bulk
    await s.db.settings.update('me', { name: 'Максим' })
    await settle()
    expect(JSON.stringify(await journalBytes(name))).not.toContain('Нина')

    const t = load(name)
    await t.vault.boot()
    await t.vault.unlock({ kind: 'password', password }, Date.now() + 1)
    const names = (await t.db.people.toArray()).map(p => p.firstName).sort()
    expect(names).toEqual(['Ева', 'Лев', 'Нина', 'Ольга'].sort())
    expect((await t.db.people.get('p1'))?.notes).toBe('теперь любит кофе')
    expect((await t.db.settings.get('me'))?.name).toBe('Максим')
  })

  it('clearing a table is written too', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await s.vault.unlock({ kind: 'password', password })
    await s.db.people.clear()
    await settle()
    const t = load(name)
    await t.vault.boot()
    await t.vault.unlock({ kind: 'password', password })
    expect(await t.db.people.count()).toBe(0)
    expect((await t.db.settings.get('me'))?.name).toBe('Макс')
  })

  it('locking writes what is pending first, then reloads', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await s.vault.unlock({ kind: 'password', password })
    await s.db.people.add(personOf('late', { firstName: 'Поздно' }))
    await s.vault.lock() // no waiting for the timer
    expect(s.reload).toHaveBeenCalledTimes(1)
    const t = load(name)
    await t.vault.boot()
    await t.vault.unlock({ kind: 'password', password })
    expect((await t.db.people.get('late'))?.firstName).toBe('Поздно')
  })

  it('blobs and dates in a row survive', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await s.vault.unlock({ kind: 'password', password })
    await s.db.people.update('p1', { photo: 'data:image/png;base64,AAAA' })
    await settle()
    const t = load(name)
    await t.vault.boot()
    await t.vault.unlock({ kind: 'password', password })
    expect((await t.db.people.get('p1'))?.photo).toBe('data:image/png;base64,AAAA')
  })
})

describe('tampering with the journal on disk', () => {
  async function tamper(name: string, f: (j: Awaited<ReturnType<typeof openJournal>>) => Promise<void>) {
    const j = await openJournal(indexedDB, `${name}-vault`)
    await f(j)
    j.close()
  }

  it('a changed record is refused, not silently read', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    await tamper(name, async j => {
      const rows: Array<[string, Uint8Array]> = []
      await j.eachRow((k, b) => { rows.push([k, b]) })
      const [k, b] = rows[0]!
      const changed = new Uint8Array(b); changed[20] = changed[20]! ^ 1
      await j.putRows([[k, changed]])
    })
    const s = load(name)
    await s.vault.boot()
    expect(await s.vault.unlock({ kind: 'password', password })).toBe('error')
    expect(useVaultState.getState().state).toBe('locked')
  })

  it('a record moved to another place is refused: it is bound to its slot', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    await tamper(name, async j => {
      const rows = new Map<string, Uint8Array>()
      await j.eachRow((k, b) => { rows.set(k, b) })
      const a = slot('people', 'p1'), b = slot('people', 'p2')
      await j.putRows([[a, rows.get(b)!], [b, rows.get(a)!]])
    })
    const s = load(name)
    await s.vault.boot()
    expect(await s.vault.unlock({ kind: 'password', password })).toBe('error')
  })

  it('a swapped header (another vault\'s keys) does not open this data', async () => {
    const a = fresh(), b = fresh()
    await enabled(a, 'пароль-первого')
    await enabled(b, 'пароль-второго')
    const jb = await openJournal(indexedDB, `${b}-vault`)
    const headerB = await jb.header()
    jb.close()
    await tamper(a, async j => { await j.putHeader(headerB!) })
    const s = load(a)
    await s.vault.boot()
    expect(await s.vault.unlock({ kind: 'password', password: 'пароль-второго' })).toBe('error') // the right password, the wrong data key
  })
})

describe('turning encryption off', () => {
  it('brings the plain database back with all the data and removes the journal', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await s.vault.unlock({ kind: 'password', password })
    await s.db.people.add(personOf('p9', { firstName: 'Новая' }))
    await s.vault.disable()
    expect(s.reload).toHaveBeenCalled()
    expect(await databases()).not.toContain(`${name}-vault`)
    expect(await databases()).toContain(name)

    const t = load(name)
    expect(await t.vault.boot()).toBe('off')
    expect((await t.db.people.toArray()).map(p => p.firstName).sort()).toEqual(['Игорь', 'Новая', 'Ольга'])
    expect((await t.db.settings.get('me'))?.name).toBe('Макс')
  })

  it('needs the vault unlocked', async () => {
    const name = fresh()
    await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await expect(s.vault.disable()).rejects.toThrow()
  })
})

describe('opening in a second window', () => {
  it('while the vault is open in another window, a second one is told so and opens nothing', async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    const original = Object.getOwnPropertyDescriptor(navigator, 'locks')
    // the other window holds the lock: "if available" finds nothing
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_n: string, _o: unknown, cb: (l: null) => void) => { cb(null); return Promise.resolve() } } })
    try {
      expect(await s.vault.unlock({ kind: 'password', password })).toBe('tab')
      expect(s.vault.state()).toBe('locked')
    } finally {
      if (original) Object.defineProperty(navigator, 'locks', original); else delete (navigator as unknown as Record<string, unknown>).locks
    }
  })
})

describe('"I lost every way in"', () => {
  it('erases the encrypted data for good and reloads: the next load starts empty and not locked', async () => {
    const name = fresh()
    await enabled(name)
    const s = load(name)
    await s.vault.boot()
    localStorage.setItem('aster.vault.throttle', JSON.stringify({ failures: 5, until: Date.now() + 60_000 }))
    await s.vault.eraseEverything()
    expect(s.reload).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('aster.vault')).toBeNull()
    expect(localStorage.getItem('aster.vault.throttle')).toBeNull()
    expect(await databases()).not.toContain(`${name}-vault`)
    const t = load(name)
    expect(await t.vault.boot()).toBe('off')
    expect(await t.db.people.count()).toBe(0)
  })
})

describe('locking by itself', () => {
  const unlocked = async () => {
    const name = fresh()
    const { password } = await enabled(name)
    const s = load(name)
    await s.vault.boot()
    await s.vault.unlock({ kind: 'password', password })
    return s
  }

  it('the waiting time is kept per device, 5 minutes by default', async () => {
    const s = load(fresh())
    expect(s.vault.autoLockMinutes()).toBe(5)
    s.vault.setAutoLockMinutes(15)
    expect(s.vault.autoLockMinutes()).toBe(15)
    expect(localStorage.getItem('aster.vault.autolock')).toBe('15')
  })

  it('locks after the waiting time without any touch, and a touch starts the wait again', async () => {
    const s = await unlocked()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      window.dispatchEvent(new Event('pointerdown')) // a touch re-arms the timer from now
      await vi.advanceTimersByTimeAsync(4 * 60_000)
      window.dispatchEvent(new Event('keydown'))
      await vi.advanceTimersByTimeAsync(4 * 60_000)
      expect(s.reload).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(61_000)
      expect(s.reload).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('"never" (0 minutes) does not lock by itself', async () => {
    const s = await unlocked()
    s.vault.setAutoLockMinutes(0)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      window.dispatchEvent(new Event('pointerdown'))
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(s.reload).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('leaving the tab writes what is pending; coming back after the waiting time locks, a short absence does not', async () => {
    const s = await unlocked()
    const visibility = (value: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    await s.db.people.add(personOf('p9', { firstName: 'Поздно' }))
    visibility('hidden')
    await settle()
    const j = await openJournal(indexedDB, `${s.name}-vault`)
    let rows = 0
    await j.eachRow(() => { rows++ })
    j.close()
    expect(rows).toBeGreaterThanOrEqual(3) // the two from before and the new one

    const now = vi.spyOn(Date, 'now')
    const t0 = Date.now()
    now.mockReturnValue(t0 + 60_000)
    visibility('visible') // one minute away: still open
    expect(s.reload).not.toHaveBeenCalled()
    visibility('hidden')
    now.mockReturnValue(t0 + 60_000 + 6 * 60_000)
    visibility('visible') // six minutes away: locked
    await settle()
    expect(s.reload).toHaveBeenCalledTimes(1)
    delete (document as unknown as Record<string, unknown>).visibilityState
  })
})
