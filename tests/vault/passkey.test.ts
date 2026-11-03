import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PasskeyError, passkeySupported, registerPasskey, askVaultPasskey } from '@/vault/passkey'
import { fromBase64, toBase64 } from '@/crypto/bytes'
import type { Wrap } from '@/vault/keys'

/** A stand-in authenticator: the PRF secret is a hash of the credential and the salt, as real hardware makes one from its own key. */
function fakeAuthenticator(opts: { prf?: boolean; cancel?: boolean } = {}) {
  const creds = new Map<string, Uint8Array>()
  const prf = async (id: Uint8Array, salt: BufferSource) => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...id, ...new Uint8Array(salt as ArrayBuffer)]))).buffer
  const create = vi.fn(async () => {
    if (opts.cancel) throw Object.assign(new Error('x'), { name: 'NotAllowedError' })
    const rawId = crypto.getRandomValues(new Uint8Array(16))
    creds.set(toBase64(rawId), rawId)
    return { rawId: rawId.buffer, getClientExtensionResults: () => ({ prf: { enabled: opts.prf !== false } }) }
  })
  const get = vi.fn(async ({ publicKey }: { publicKey: PublicKeyCredentialRequestOptions & { extensions?: { prf?: { eval?: { first: BufferSource }; evalByCredential?: Record<string, { first: BufferSource }> } } } }) => {
    if (opts.cancel) throw Object.assign(new Error('x'), { name: 'NotAllowedError' })
    const allowed = (publicKey.allowCredentials ?? []).map(c => new Uint8Array(c.id as ArrayBuffer))
    const chosen = allowed[allowed.length - 1]!
    const ext = publicKey.extensions!.prf!
    const b64url = (b: Uint8Array) => toBase64(b).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    const salt = ext.eval?.first ?? ext.evalByCredential![b64url(chosen)]!.first
    return { rawId: chosen.buffer, getClientExtensionResults: () => ({ prf: { results: opts.prf === false ? {} : { first: undefined as ArrayBuffer | undefined } } }), _first: await prf(chosen, salt) }
  })
  // the assertion's extension result carries the secret
  const patched = async (arg: Parameters<typeof get>[0]) => { const a = await get(arg); return { ...a, getClientExtensionResults: () => ({ prf: { results: opts.prf === false ? {} : { first: a._first } } }) } }
  Object.defineProperty(navigator, 'credentials', { value: { create, get: patched }, configurable: true })
  ;(window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = class {}
  return { create, get }
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential })

describe('passkeys as a way to unlock', () => {
  it('knows whether the browser can do it', () => {
    delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
    expect(passkeySupported()).toBe(false)
    fakeAuthenticator()
    expect(passkeySupported()).toBe(true)
  })

  it('registers a passkey and returns the same secret every time for its salt', async () => {
    fakeAuthenticator()
    const made = await registerPasskey('Aster')
    expect(made.secret).toHaveLength(32)
    expect(made.prfSalt).toHaveLength(32)
    const wrap: Wrap = { kind: 'passkey', iv: '', data: '', credentialId: made.credentialId, prfSalt: toBase64(made.prfSalt), createdAt: 0 }
    const again = await askVaultPasskey([wrap])
    expect(again.credentialId).toBe(made.credentialId)
    expect([...again.secret]).toEqual([...made.secret])
  })

  it('two passkeys give different secrets, and each is found by its own id', async () => {
    fakeAuthenticator()
    const a = await registerPasskey('Aster')
    const b = await registerPasskey('Aster')
    expect(a.credentialId).not.toBe(b.credentialId)
    expect([...a.secret]).not.toEqual([...b.secret])
    const wrapOf = (m: typeof a): Wrap => ({ kind: 'passkey', iv: '', data: '', credentialId: m.credentialId, prfSalt: toBase64(m.prfSalt), createdAt: 0 })
    const used = await askVaultPasskey([wrapOf(a), wrapOf(b)])
    expect([a.credentialId, b.credentialId]).toContain(used.credentialId)
    expect([...used.secret]).toEqual([...(used.credentialId === a.credentialId ? a : b).secret])
    expect(fromBase64(toBase64(used.secret))).toHaveLength(32)
  })

  it('says so when the authenticator has no PRF, and when the person cancels', async () => {
    fakeAuthenticator({ prf: false })
    await expect(registerPasskey('Aster')).rejects.toMatchObject({ code: 'unsupported' })
    fakeAuthenticator({ cancel: true })
    await expect(registerPasskey('Aster')).rejects.toMatchObject({ code: 'cancelled' })
    await expect(askVaultPasskey([{ kind: 'passkey', iv: '', data: '', credentialId: 'AAAA', prfSalt: toBase64(new Uint8Array(32)), createdAt: 0 }])).rejects.toBeInstanceOf(PasskeyError)
  })

  it('refuses when no passkey was ever set up', async () => {
    fakeAuthenticator()
    await expect(askVaultPasskey([])).rejects.toMatchObject({ code: 'unsupported' })
  })
})
