import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importBackup, exportBackup, saveSettings } from '@/data/actions'
import { createAutoBackupKey, isEncryptedBackup, openBackup, sealBackupToKey, sealBackupWithPassword } from '@/data/backupSeal'
import { runAutoBackup } from '@/data/autoBackup'
import { db } from '@/data/db'
import { personOf } from '../cloud/rows'
import { resetDb } from '../helpers'

const written = vi.hoisted(() => ({ files: [] as Array<{ name: string; text: string; prefix: string; keep: number }>, access: 'granted' as 'granted' | 'prompt' | 'none' }))
vi.mock('@/lib/folder', () => ({
  folderAccess: async () => written.access,
  writeToFolder: async (name: string, text: string, prefix: string, keep: number) => { written.files.push({ name, text, prefix, keep }) },
}))

const argon2 = { m: 64, t: 1, p: 1 }
beforeEach(async () => { await resetDb(); written.files = []; written.access = 'granted' })

describe('a backup sealed with a password', () => {
  it('opens only with the password, and what comes out imports like the original', async () => {
    await saveSettings({ name: 'Макс', onboarded: true })
    await db.people.add(personOf('p1', { firstName: 'Ольга', notes: 'любит чай' }))
    const plain = await exportBackup()
    const file = await sealBackupWithPassword(plain, 'пароль-копии', argon2)

    expect(isEncryptedBackup(file)).toBe(true)
    expect(JSON.stringify(file)).not.toContain('Ольга') // nothing readable in the file
    expect(JSON.stringify(file)).not.toContain('любит чай')
    await expect(openBackup(file, 'не тот')).rejects.toMatchObject({ code: 'wrong_password' })

    await resetDb()
    await importBackup(await openBackup(file, 'пароль-копии'))
    expect((await db.people.get('p1'))?.notes).toBe('любит чай')
  })

  it('cannot be passed off as an automatic copy, or the reverse', async () => {
    const file = await sealBackupWithPassword({ app: 'aster' }, 'p', argon2)
    expect(isEncryptedBackup({ ...file, encrypted: 'key' })).toBe(true) // the shape check is cheap...
    await expect(openBackup({ ...file, encrypted: 'key' } as never, 'p')).rejects.toMatchObject({ code: 'invalid_payload' }) // ...opening is strict
  })

  it('a plain backup is not an encrypted one', () => {
    expect(isEncryptedBackup({ app: 'aster', version: 4, people: [] })).toBe(false)
    expect(isEncryptedBackup(null)).toBe(false)
    expect(isEncryptedBackup({ app: 'other', encrypted: 'password', sealed: {} })).toBe(false)
  })
})

describe('an automatic copy sealed to a public key', () => {
  it('is made without any secret and opens with the passphrase, years later', async () => {
    const config = await createAutoBackupKey('correct horse battery', argon2)
    expect(config.publicKey.length).toBeGreaterThan(1500) // X25519 + ML-KEM-768
    const file = await sealBackupToKey({ app: 'aster', exportedAt: '2026-11-03', people: [{ id: 'p1', firstName: 'Ольга' }] }, config)
    expect(file.encrypted).toBe('key')
    expect(JSON.stringify(file)).not.toContain('Ольга')
    expect(JSON.stringify(file)).not.toContain('correct horse') // the passphrase is not in the file, nor is anything derived from it
    expect(await openBackup(file, 'correct horse battery')).toMatchObject({ people: [{ firstName: 'Ольга' }] })
    await expect(openBackup(file, 'correct horse battery!')).rejects.toMatchObject({ code: 'wrong_password' })
  })

  it('refuses a damaged cost or salt instead of running it', async () => {
    const config = await createAutoBackupKey('pp', argon2)
    const file = await sealBackupToKey({ app: 'aster' }, config)
    await expect(openBackup({ ...file, kdf: { ...file.kdf, m: 99_999_999 } }, 'pp')).rejects.toMatchObject({ code: 'invalid_payload' })
    await expect(openBackup({ ...file, kdf: { ...file.kdf, salt: '***' } }, 'pp')).rejects.toMatchObject({ code: 'invalid_payload' })
  })
})

describe('automatic backups into a folder', () => {
  const setup = async (patch: object = {}) => {
    await saveSettings({ name: 'Макс', onboarded: true, autoBackup: { ...(await createAutoBackupKey('pp', argon2)), folder: 'Документы', everyDays: 1, ...patch } })
    await db.people.add(personOf('p1', { firstName: 'Ольга' }))
  }
  const DAY = 86_400_000

  it('does nothing until it is set up', async () => {
    expect(await runAutoBackup()).toBe('off')
    expect(written.files).toHaveLength(0)
  })

  it('writes an encrypted copy and remembers when', async () => {
    await setup()
    const now = Date.UTC(2026, 10, 3, 12)
    expect(await runAutoBackup({ now })).toBe('written')
    expect(written.files).toHaveLength(1)
    expect(written.files[0]).toMatchObject({ name: 'aster-auto-2026-11-03.aster.json', prefix: 'aster-auto-', keep: 14 })
    expect(written.files[0]!.text).not.toContain('Ольга')
    const me = await db.settings.get('me')
    expect(me?.autoBackup?.lastAt).toBe(now)
    expect(me?.lastBackupAt).toBe(now)
    expect(await openBackup(JSON.parse(written.files[0]!.text), 'pp')).toMatchObject({ people: [{ firstName: 'Ольга' }] })
  })

  it('waits for the next due day, and writes again after it', async () => {
    await setup({ everyDays: 2 })
    const t0 = Date.UTC(2026, 10, 3, 12)
    expect(await runAutoBackup({ now: t0 })).toBe('written')
    expect(await runAutoBackup({ now: t0 + DAY })).toBe('not-due')
    expect(await runAutoBackup({ now: t0 + 2 * DAY })).toBe('written')
    expect(written.files).toHaveLength(2)
  })

  it('does not write when the browser no longer allows the folder, and says so', async () => {
    await setup()
    written.access = 'prompt'
    expect(await runAutoBackup()).toBe('needs-permission')
    expect(written.files).toHaveLength(0)
    expect((await db.settings.get('me'))?.autoBackup?.lastAt).toBeUndefined() // so it tries again at the next opening
  })

  it('the settings for the folder stay on this device: not in a backup, not in a restore', async () => {
    await setup()
    const plain = await exportBackup()
    expect(JSON.stringify(plain)).not.toContain('publicKey')
    await importBackup(plain)
    expect((await db.settings.get('me'))?.autoBackup?.folder).toBe('Документы')
  })
})
