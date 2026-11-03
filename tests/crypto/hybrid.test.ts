import { describe, expect, it } from 'vitest'
import { HYBRID_SEED_BYTES, decodePublicKey, encodePublicKey, hybridKeyPairFromPassphrase, hybridKeyPairFromSeed, hybridKeyPairRandom, hybridOpen, hybridSeal } from '@/crypto/hybrid'
import { fromBase64, toBase64, utf8, fromUtf8, randomBytes } from '@/crypto/bytes'

const text = 'Привет, «Aster» — резервная копия 🚀'

describe('hybrid sealing (X25519 + ML-KEM-768)', () => {
  it('round-trips with only the public key at hand to seal', async () => {
    const kp = await hybridKeyPairRandom()
    const sealed = await hybridSeal(kp.publicKey, utf8(text), 'backup')
    expect(sealed).toMatchObject({ v: 1, alg: 'X25519+ML-KEM-768/AES-256-GCM' })
    expect(fromBase64(sealed.epk)).toHaveLength(32)
    expect(fromBase64(sealed.ct)).toHaveLength(1088) // ML-KEM-768 ciphertext
    expect(fromUtf8(await hybridOpen(kp.secretKey, kp.publicKey, sealed, 'backup'))).toBe(text)
  })

  it('every seal is different, even for the same data and key', async () => {
    const kp = await hybridKeyPairRandom()
    const a = await hybridSeal(kp.publicKey, utf8('x'), 'k')
    const b = await hybridSeal(kp.publicKey, utf8('x'), 'k')
    expect(a.epk).not.toBe(b.epk)
    expect(a.ct).not.toBe(b.ct)
    expect(a.data).not.toBe(b.data)
  })

  it('only the matching key opens it', async () => {
    const mine = await hybridKeyPairRandom()
    const other = await hybridKeyPairRandom()
    const sealed = await hybridSeal(mine.publicKey, utf8('x'))
    await expect(hybridOpen(other.secretKey, mine.publicKey, sealed)).rejects.toMatchObject({ code: 'wrong_password' })
    // a key pair that has the right X25519 half but the wrong ML-KEM half is refused too: BOTH must match
    const halfX = { x: mine.secretKey.x, k: other.secretKey.k }
    await expect(hybridOpen(halfX, mine.publicKey, sealed)).rejects.toMatchObject({ code: 'wrong_password' })
    const halfK = { x: other.secretKey.x, k: mine.secretKey.k }
    await expect(hybridOpen(halfK, mine.publicKey, sealed)).rejects.toMatchObject({ code: 'wrong_password' })
  })

  it('refuses another purpose and any changed part of the envelope', async () => {
    const kp = await hybridKeyPairRandom()
    const sealed = await hybridSeal(kp.publicKey, utf8('x'), 'backup')
    await expect(hybridOpen(kp.secretKey, kp.publicKey, sealed, 'sync')).rejects.toMatchObject({ code: 'wrong_password' })
    for (const field of ['epk', 'ct', 'iv', 'data'] as const) {
      const bytes = fromBase64(sealed[field])
      bytes[0] = bytes[0]! ^ 1
      await expect(hybridOpen(kp.secretKey, kp.publicKey, { ...sealed, [field]: toBase64(bytes) }, 'backup')).rejects.toMatchObject({ code: 'wrong_password' })
    }
  })

  it('refuses a damaged envelope with a clear error', async () => {
    const kp = await hybridKeyPairRandom()
    const sealed = await hybridSeal(kp.publicKey, utf8('x'))
    await expect(hybridOpen(kp.secretKey, kp.publicKey, { ...sealed, ct: toBase64(new Uint8Array(10)) })).rejects.toMatchObject({ code: 'invalid_payload' })
    await expect(hybridOpen(kp.secretKey, kp.publicKey, { ...sealed, epk: '***' })).rejects.toMatchObject({ code: 'invalid_payload' })
    await expect(hybridOpen(kp.secretKey, kp.publicKey, { ...sealed, v: 2 } as never)).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('the same seed is the same key pair; a seed of the wrong size is refused', async () => {
    const seed = randomBytes(HYBRID_SEED_BYTES)
    const a = await hybridKeyPairFromSeed(seed)
    const b = await hybridKeyPairFromSeed(seed)
    expect(encodePublicKey(a.publicKey)).toBe(encodePublicKey(b.publicKey))
    await expect(hybridKeyPairFromSeed(new Uint8Array(10))).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('a passphrase stands for a key pair: the file made today opens with the passphrase later', async () => {
    const salt = randomBytes(16)
    const params = { m: 64, t: 1, p: 1 }
    const made = await hybridKeyPairFromPassphrase('correct horse', salt, params)
    const sealed = await hybridSeal(made.publicKey, utf8(text), 'backup')
    const later = await hybridKeyPairFromPassphrase('correct horse', salt, params)
    expect(fromUtf8(await hybridOpen(later.secretKey, later.publicKey, sealed, 'backup'))).toBe(text)
    const wrong = await hybridKeyPairFromPassphrase('wrong horse', salt, params)
    await expect(hybridOpen(wrong.secretKey, wrong.publicKey, sealed, 'backup')).rejects.toMatchObject({ code: 'wrong_password' })
  })

  it('a public key survives being written down', async () => {
    const kp = await hybridKeyPairRandom()
    const text2 = encodePublicKey(kp.publicKey)
    const back = decodePublicKey(text2)
    expect([...back.x]).toEqual([...kp.publicKey.x])
    expect([...back.k]).toEqual([...kp.publicKey.k])
    expect(() => decodePublicKey('not base64 !!')).toThrow()
    expect(() => decodePublicKey(toBase64(new Uint8Array(5)))).toThrow()
  })
})
