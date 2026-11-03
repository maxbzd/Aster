import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ARGON2_DEFAULT, CryptoError, checkPassword, createPasswordCheck, forgetDerivedKeys, openTextWithPassword, openWithPassword, sealTextWithPassword, sealWithPassword, validArgon2, type PasswordSealed } from '@/crypto/password'
import { fromBase64 } from '@/crypto/bytes'

const argon2 = { m: 64, t: 1, p: 1 }
const runs = vi.hoisted(() => ({ n: 0 }))
vi.mock('@noble/hashes/argon2.js', async original => {
  const real = await original<typeof import('@noble/hashes/argon2.js')>()
  return { ...real, argon2idAsync: (...a: Parameters<typeof real.argon2idAsync>) => { runs.n++; return real.argon2idAsync(...a) } }
})
beforeEach(() => { runs.n = 0; forgetDerivedKeys() })

describe('sealing with a password', () => {
  it('round-trips text in any script', async () => {
    const text = 'Привет «Aster» 🚀 café'
    expect(await openTextWithPassword('пароль', await sealTextWithPassword('пароль', text, { argon2, aad: 'x' }), { aad: 'x' })).toBe(text)
  })

  it('describes the format; salt and iv are random; the password is nowhere', async () => {
    const a = await sealTextWithPassword('secret-pw', 'x', { argon2 })
    const b = await sealTextWithPassword('secret-pw', 'x', { argon2 })
    expect(a).toMatchObject({ v: 2, alg: 'AES-GCM', kdf: 'Argon2id', ...argon2 })
    expect(fromBase64(a.salt)).toHaveLength(16)
    expect(fromBase64(a.iv)).toHaveLength(12)
    expect(a.salt).not.toBe(b.salt)
    expect(a.data).not.toBe(b.data)
    expect(JSON.stringify(a)).not.toContain('secret-pw')
  })

  it('uses a default cost above the OWASP minimum', () => {
    expect(ARGON2_DEFAULT.m).toBeGreaterThanOrEqual(19_456)
    expect(ARGON2_DEFAULT.t).toBeGreaterThanOrEqual(2)
    expect(validArgon2(ARGON2_DEFAULT)).toBe(true)
  })

  it('rejects a wrong password, a changed byte, another purpose and a changed cost', async () => {
    const sealed = await sealTextWithPassword('верный', 'тайна', { argon2: { m: 64, t: 2, p: 1 }, aad: 'backup' })
    await expect(openTextWithPassword('неверный', sealed, { aad: 'backup' })).rejects.toMatchObject({ code: 'wrong_password' })
    await expect(openTextWithPassword('верный', sealed, { aad: 'keys' })).rejects.toMatchObject({ code: 'wrong_password' })
    await expect(openTextWithPassword('верный', { ...sealed, t: 1 }, { aad: 'backup' })).rejects.toMatchObject({ code: 'wrong_password' })
    const bytes = fromBase64(sealed.data)
    bytes[0] = bytes[0]! ^ 1
    await expect(openTextWithPassword('верный', { ...sealed, data: btoa(String.fromCharCode(...bytes)) }, { aad: 'backup' })).rejects.toMatchObject({ code: 'wrong_password' })
  })

  it('refuses a cost that would exhaust memory, and a damaged envelope', async () => {
    const sealed = await sealTextWithPassword('p', 'x', { argon2 })
    await expect(openTextWithPassword('p', { ...sealed, m: 4_000_000 })).rejects.toMatchObject({ code: 'invalid_payload' })
    await expect(openTextWithPassword('p', { ...sealed, salt: '***' })).rejects.toMatchObject({ code: 'invalid_payload' })
    await expect(openTextWithPassword('p', { ...sealed, v: 1 } as unknown as PasswordSealed)).rejects.toBeInstanceOf(CryptoError)
    expect(runs.n).toBe(1) // only the real seal paid for Argon2id
  })

  it('treats composed and decomposed Unicode as the same password', async () => {
    const sealed = await sealTextWithPassword('café', 'x', { argon2 })
    expect(await openTextWithPassword('café', sealed)).toBe('x')
  })

  it('seals raw bytes', async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255])
    expect([...(await openWithPassword('p', await sealWithPassword('p', bytes, { argon2 })))]).toEqual([...bytes])
  })
})

describe('the password check', () => {
  it('accepts the password and nothing else', async () => {
    const stored = await createPasswordCheck('1234пароль', argon2)
    expect(await checkPassword('1234пароль', stored)).toBe(true)
    expect(await checkPassword('1234пароль ', stored)).toBe(false)
    expect(await checkPassword('', stored)).toBe(false)
    expect(JSON.stringify(stored)).not.toContain('1234')
  })

  it('shares one derivation with data sealed under the same salt', async () => {
    const check = await createPasswordCheck('пароль', argon2)
    const sealed = await sealTextWithPassword('пароль', 'ключи', { argon2, salt: check.salt, aad: 'k' })
    runs.n = 0
    forgetDerivedKeys()
    expect(await checkPassword('пароль', check)).toBe(true)
    expect(await openTextWithPassword('пароль', sealed, { aad: 'k' })).toBe('ключи')
    expect(runs.n).toBe(1)
  })

  it('the check value is not the encryption key: it does not open the data', async () => {
    const check = await createPasswordCheck('pw', argon2)
    const sealed = await sealTextWithPassword('pw', 'x', { argon2, salt: check.salt })
    expect(check.verifier).not.toBe(sealed.data)
    expect(fromBase64(check.verifier)).toHaveLength(32)
  })
})
