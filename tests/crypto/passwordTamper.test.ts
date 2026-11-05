import { describe, expect, it } from 'vitest'
import { CryptoError, openWithPassword, sealWithPassword, type PasswordSealed } from '@/crypto/password'
import { fromBase64, utf8 } from '@/crypto/bytes'

const argon2 = { m: 64, t: 1, p: 1 } // cheap on purpose: the point is the envelope, not the cost
const secret = utf8('любит чай и джаз')

/** Opens, and reports "opened" or the kind of refusal. */
const tryOpen = async (sealed: unknown, aad?: string) => {
  try { await openWithPassword('пароль-для-теста', sealed as PasswordSealed, { aad }); return 'opened' } catch (e) { return e instanceof CryptoError ? e.code : 'crashed' }
}

describe('a password-sealed envelope cannot be changed without notice', () => {
  it('opens untouched, and a wrong password or a wrong purpose does not', async () => {
    const sealed = await sealWithPassword('пароль-для-теста', secret, { argon2, aad: 'backup' })
    expect(await tryOpen(sealed, 'backup')).toBe('opened')
    expect(await tryOpen(sealed, 'other')).toBe('wrong_password')
    expect(await tryOpen(sealed)).toBe('wrong_password')
  })

  it('changing any character of the salt, the IV or the data is refused, never a crash and never a different plaintext', async () => {
    const sealed = await sealWithPassword('пароль-для-теста', secret, { argon2, aad: 'backup' })
    const outcomes = new Set<string>()
    for (const field of ['salt', 'iv', 'data'] as const) {
      const text = sealed[field]
      // every position would take minutes of key derivation: the two ends, the middle and a few spread in between cover each part
      const positions = [...new Set([0, 1, 2, text.length >> 2, text.length >> 1, (text.length * 3) >> 2, text.length - 3, text.length - 2, text.length - 1])]
      for (const i of positions) {
        // swap one base64 character for another valid one
        const next = text[i] === 'A' ? 'B' : 'A'
        const changed = text.slice(0, i) + next + text.slice(i + 1)
        // the last characters of base64 can carry bits that mean nothing: such a change leaves the very same bytes, so there is nothing to refuse
        const sameBytes = (() => { try { return fromBase64(changed).toString() === fromBase64(text).toString() } catch { return false } })()
        if (sameBytes) continue
        outcomes.add(await tryOpen({ ...sealed, [field]: changed }, 'backup'))
      }
    }
    // padding characters ("=") swapped for letters change the length, which is also refused
    expect([...outcomes].filter(o => o === 'opened' || o === 'crashed')).toEqual([])
  }, 60_000)

  it('a damaged envelope is told apart from a wrong password', async () => {
    const sealed = await sealWithPassword('пароль-для-теста', secret, { argon2 })
    expect(await tryOpen({ ...sealed, v: 1 })).toBe('invalid_payload')
    expect(await tryOpen({ ...sealed, kdf: 'PBKDF2' })).toBe('invalid_payload')
    expect(await tryOpen({ ...sealed, salt: '***not base64***' })).toMatch(/invalid_payload|wrong_password/)
    expect(await tryOpen(null)).toBe('invalid_payload')
    expect(await tryOpen({})).toBe('invalid_payload')
  })

  it('a file that asks for an absurd cost is refused before any work is done (no way to hang or exhaust memory)', async () => {
    const sealed = await sealWithPassword('пароль-для-теста', secret, { argon2 })
    for (const cost of [{ m: 4_000_000 }, { t: 1000 }, { m: 0 }, { t: 0 }, { p: 0 }, { m: -1 }, { m: 1.5 }, { m: Number.NaN }]) {
      const started = performance.now()
      expect(await tryOpen({ ...sealed, ...cost })).toBe('invalid_payload')
      expect(performance.now() - started).toBeLessThan(500)
    }
  })

  it('lower cost parameters on the file do not open it either (the cost is part of the key)', async () => {
    const sealed = await sealWithPassword('пароль-для-теста', secret, { argon2 })
    expect(await tryOpen({ ...sealed, t: 2 })).toBe('wrong_password')
    expect(await tryOpen({ ...sealed, m: 128 })).toBe('wrong_password')
  })
})
