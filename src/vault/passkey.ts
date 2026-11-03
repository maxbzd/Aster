import { fromBase64, randomBytes, toBase64 } from '@/crypto/bytes';
import type { Wrap } from './keys';

/**
 * Unlocking with a passkey (Face ID, Touch ID, Windows Hello, a security key) through the WebAuthn PRF extension.
 * The authenticator computes a 32-byte secret from a salt we give it; that secret is the key that wraps the data key.
 * It is produced inside the authenticator (the phone's secure hardware) after a fingerprint or face check, and is
 * never stored anywhere: someone who copies the disk has nothing to try, so there is no password to guess.
 * Supported by Chrome, Edge, Safari 18 and recent Android and iOS; where it is not, the option is simply not shown.
 */

export const passkeySupported = (): boolean =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && typeof navigator.credentials?.create === 'function';

export class PasskeyError extends Error {
  constructor(readonly code: 'unsupported' | 'cancelled' | 'failed', message: string) {
    super(message);
    this.name = 'PasskeyError';
  }
}

const b64url = (bytes: Uint8Array): string => toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromB64url = (text: string): Uint8Array<ArrayBuffer> => fromBase64(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4));

type Ext = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
const extensions = (c: Credential | null): Ext => (c as PublicKeyCredential | null)?.getClientExtensionResults() as Ext;

function asPasskeyError(e: unknown): PasskeyError {
  if (e instanceof PasskeyError) return e;
  const name = (e as { name?: string })?.name;
  return name === 'NotAllowedError' || name === 'AbortError' ? new PasskeyError('cancelled', 'Cancelled.') : new PasskeyError('failed', 'The passkey did not work.');
}

/** Makes a passkey for this vault and returns the secret it gives for the salt. @throws PasskeyError */
export async function registerPasskey(appName: string): Promise<{ credentialId: string; prfSalt: Uint8Array<ArrayBuffer>; secret: Uint8Array<ArrayBuffer> }> {
  if (!passkeySupported()) throw new PasskeyError('unsupported', 'Passkeys are not available here.');
  try {
    const created = (await navigator.credentials.create({
      publicKey: {
        rp: { name: appName },
        user: { id: randomBytes(16), name: appName, displayName: appName },
        challenge: randomBytes(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!created) throw new PasskeyError('failed', 'The passkey was not created.');
    if (!extensions(created).prf?.enabled) throw new PasskeyError('unsupported', 'This passkey cannot be used to unlock (no PRF).');
    const credentialId = b64url(new Uint8Array(created.rawId));
    const prfSalt = randomBytes(32);
    // the secret is read with a second touch: some authenticators only evaluate the PRF at sign-in
    const secret = await passkeySecret(credentialId, prfSalt);
    return { credentialId, prfSalt, secret };
  } catch (e) {
    throw asPasskeyError(e);
  }
}

async function passkeySecret(credentialId: string, prfSalt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const got = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  });
  const first = extensions(got).prf?.results?.first;
  if (!first || first.byteLength < 32) throw new PasskeyError('unsupported', 'This passkey cannot be used to unlock (no PRF).');
  return new Uint8Array(first).slice(0, 32);
}

/** Asks for any of the vault's passkeys and returns which one was used and its secret. @throws PasskeyError */
export async function askVaultPasskey(wraps: Wrap[]): Promise<{ credentialId: string; secret: Uint8Array<ArrayBuffer> }> {
  const usable = wraps.filter(w => w.kind === 'passkey' && w.credentialId && w.prfSalt);
  if (!passkeySupported() || usable.length === 0) throw new PasskeyError('unsupported', 'No passkey is set up here.');
  try {
    const evalByCredential: Record<string, { first: Uint8Array }> = {};
    for (const w of usable) evalByCredential[w.credentialId!] = { first: fromBase64(w.prfSalt!) };
    const got = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: usable.map(w => ({ type: 'public-key' as const, id: fromB64url(w.credentialId!) })),
        userVerification: 'required',
        extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const first = extensions(got).prf?.results?.first;
    if (!got || !first || first.byteLength < 32) throw new PasskeyError('failed', 'The passkey did not give a key.');
    return { credentialId: b64url(new Uint8Array(got.rawId)), secret: new Uint8Array(first).slice(0, 32) };
  } catch (e) {
    throw asPasskeyError(e);
  }
}
