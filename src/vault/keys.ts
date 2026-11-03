import { constantTimeEqual, fromBase64, randomBytes, toBase64, utf8, wipe } from '@/crypto/bytes';
import { ARGON2_DEFAULT, CryptoError, aesKeyFrom, hkdfBits, stretch, validArgon2, type Argon2Params } from '@/crypto/password';

/**
 * The key hierarchy of the vault.
 *
 *   DEK, 256 random bits, encrypts every row.
 *   The DEK is stored only wrapped (AES-256-GCM), once for each way in:
 *     password   KEK = HKDF(Argon2id(password))
 *     recovery   KEK = HKDF(a random 256-bit recovery key, shown to the person once)
 *     passkey    KEK = HKDF(the WebAuthn PRF output of a passkey; the secret never leaves the authenticator)
 *
 * Any one of them opens the vault; changing a password re-wraps 32 bytes instead of re-encrypting the data, and a lost
 * password is not the end if the recovery key was kept. A wrap is bound to its kind and to the app (AAD), so one cannot
 * be moved into another slot.
 */

export type WrapKind = 'password' | 'recovery' | 'passkey';

export interface Wrap {
  kind: WrapKind;
  iv: string;
  /** the wrapped DEK */
  data: string;
  /** password: Argon2id salt and cost */
  salt?: string;
  argon2?: Argon2Params;
  /** passkey: credential id and the salt given to the PRF */
  credentialId?: string;
  prfSalt?: string;
  /** shown in the settings list */
  label?: string;
  createdAt: number;
}

export interface VaultHeader {
  v: 1;
  app: string;
  createdAt: number;
  wraps: Wrap[];
}

export const DEK_BYTES = 32;

const wrapAad = (app: string, kind: WrapKind) => utf8(`${app}/vault/wrap/${kind}`);
const HKDF_WRAP = (app: string) => `${app}/vault/kek`;

async function kekFrom(app: string, secret: Uint8Array): Promise<CryptoKey> {
  return aesKeyFrom(await hkdfBits(secret, HKDF_WRAP(app)));
}

async function wrap(app: string, kind: WrapKind, secret: Uint8Array, dek: Uint8Array, extra: Partial<Wrap>): Promise<Wrap> {
  const iv = randomBytes(12);
  const kek = await kekFrom(app, secret);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: wrapAad(app, kind) }, kek, dek as Uint8Array<ArrayBuffer>);
  return { kind, iv: toBase64(iv), data: toBase64(new Uint8Array(sealed)), createdAt: Date.now(), ...extra };
}

async function unwrap(app: string, w: Wrap, secret: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  let iv: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>;
  try {
    iv = fromBase64(w.iv);
    data = fromBase64(w.data);
  } catch {
    throw new CryptoError('invalid_payload', 'The vault is damaged.');
  }
  const kek = await kekFrom(app, secret);
  try {
    const dek = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: wrapAad(app, w.kind) }, kek, data));
    if (dek.length !== DEK_BYTES) throw new Error('size');
    return dek;
  } catch {
    throw new CryptoError('wrong_password', 'Wrong password or the vault is damaged.');
  }
}

// ───────── The recovery key people write down ─────────

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U

function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(text: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('char');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  // the unused bits of the last character must be zero: otherwise two different texts would mean the same key
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) throw new Error('padding');
  return new Uint8Array(out);
}

async function checksum(key: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', key as Uint8Array<ArrayBuffer>)).slice(0, 2);
}

/** 32 random bytes plus a 2-byte check, written as 11 groups of 5 characters: easy to read aloud and to catch a typo in. */
export async function newRecoveryKey(): Promise<{ bytes: Uint8Array<ArrayBuffer>; text: string }> {
  const bytes = randomBytes(32);
  const text = base32(new Uint8Array([...bytes, ...(await checksum(bytes))])).match(/.{1,5}/g)!.join('-');
  return { bytes, text };
}

/** @returns the 32 bytes, or `null` when the text is not a recovery key (a typo, a missing group) */
export async function parseRecoveryKey(text: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 55) return null;
  let raw: Uint8Array;
  try {
    raw = unbase32(clean);
  } catch {
    return null;
  }
  if (raw.length < 34) return null;
  const bytes = raw.slice(0, 32) as Uint8Array<ArrayBuffer>;
  return constantTimeEqual(raw.slice(32, 34), await checksum(bytes)) ? bytes : null;
}

// ───────── Creating, opening, changing ─────────

export interface NewVault {
  header: VaultHeader;
  dek: Uint8Array<ArrayBuffer>;
  /** shown once, kept by the person */
  recoveryKey: string;
}

export async function createVault(app: string, password: string, argon2: Argon2Params = ARGON2_DEFAULT): Promise<NewVault> {
  const dek = randomBytes(DEK_BYTES);
  const recovery = await newRecoveryKey();
  const salt = randomBytes(16);
  const master = await stretch(password, salt, argon2);
  const header: VaultHeader = {
    v: 1,
    app,
    createdAt: Date.now(),
    wraps: [
      await wrap(app, 'password', master, dek, { salt: toBase64(salt), argon2 }),
      await wrap(app, 'recovery', recovery.bytes, dek, {}),
    ],
  };
  wipe(master, recovery.bytes);
  return { header, dek, recoveryKey: recovery.text };
}

export async function openWithPassword(header: VaultHeader, password: string): Promise<Uint8Array<ArrayBuffer>> {
  const w = header.wraps.find(x => x.kind === 'password');
  if (!w?.salt || !w.argon2 || !validArgon2(w.argon2)) throw new CryptoError('invalid_payload', 'The vault is damaged.');
  const master = await stretch(password, fromBase64(w.salt), w.argon2);
  try {
    return await unwrap(header.app, w, master);
  } finally {
    wipe(master);
  }
}

export async function openWithRecoveryKey(header: VaultHeader, text: string): Promise<Uint8Array<ArrayBuffer>> {
  const w = header.wraps.find(x => x.kind === 'recovery');
  const bytes = await parseRecoveryKey(text);
  if (!w) throw new CryptoError('invalid_payload', 'The vault is damaged.');
  if (!bytes) throw new CryptoError('wrong_password', 'That is not a valid recovery key.');
  try {
    return await unwrap(header.app, w, bytes);
  } finally {
    wipe(bytes);
  }
}

/** The passkey's PRF output is the secret. @param secret 32 bytes from the authenticator */
export async function openWithPasskeySecret(header: VaultHeader, credentialId: string, secret: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const w = header.wraps.find(x => x.kind === 'passkey' && x.credentialId === credentialId);
  if (!w) throw new CryptoError('invalid_payload', 'This passkey is not set up for the vault.');
  return unwrap(header.app, w, secret);
}

/** Replaces the password: the DEK is wrapped again, nothing else changes. */
export async function withNewPassword(header: VaultHeader, dek: Uint8Array, password: string, argon2: Argon2Params = ARGON2_DEFAULT): Promise<VaultHeader> {
  const salt = randomBytes(16);
  const master = await stretch(password, salt, argon2);
  const next = await wrap(header.app, 'password', master, dek, { salt: toBase64(salt), argon2 });
  wipe(master);
  return { ...header, wraps: header.wraps.map(w => (w.kind === 'password' ? next : w)) };
}

/** A new recovery key: the old one stops working. */
export async function withNewRecoveryKey(header: VaultHeader, dek: Uint8Array): Promise<{ header: VaultHeader; recoveryKey: string }> {
  const recovery = await newRecoveryKey();
  const next = await wrap(header.app, 'recovery', recovery.bytes, dek, {});
  wipe(recovery.bytes);
  return { header: { ...header, wraps: header.wraps.map(w => (w.kind === 'recovery' ? next : w)) }, recoveryKey: recovery.text };
}

export async function withPasskey(header: VaultHeader, dek: Uint8Array, credentialId: string, prfSalt: Uint8Array, secret: Uint8Array, label: string): Promise<VaultHeader> {
  const next = await wrap(header.app, 'passkey', secret, dek, { credentialId, prfSalt: toBase64(prfSalt), label });
  return { ...header, wraps: [...header.wraps.filter(w => !(w.kind === 'passkey' && w.credentialId === credentialId)), next] };
}

export const withoutPasskey = (header: VaultHeader, credentialId: string): VaultHeader => ({ ...header, wraps: header.wraps.filter(w => !(w.kind === 'passkey' && w.credentialId === credentialId)) });

export const passkeys = (header: VaultHeader): Wrap[] => header.wraps.filter(w => w.kind === 'passkey');

/** The AES key that seals rows. Not extractable. */
export const rowKey = (dek: Uint8Array): Promise<CryptoKey> => aesKeyFrom(dek);
