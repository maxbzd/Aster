import { constantTimeEqual, fromBase64, randomBytes, toBase64, utf8, wipe } from './bytes';

/**
 * Password-based encryption: Argon2id (memory-hard, so a stolen file cannot be guessed against on GPUs) into one master
 * key; HKDF-SHA256 splits it into independent keys (one encrypts with AES-256-GCM, one checks the password); the
 * purpose of the data (`aad`) is authenticated with it, so a blob made for one use is refused for another.
 *
 * The cost is stored with the data, so it can be raised later. Argon2id is pure JavaScript (@noble/hashes), loaded on
 * first use: the content policy needs no `wasm-unsafe-eval`, and most launches never load it.
 */

export interface Argon2Params {
  /** memory, KiB */
  m: number;
  /** passes */
  t: number;
  /** lanes */
  p: number;
}

/** 32 MiB, 3 passes, 1 lane: above the OWASP minimum (19 MiB, 2 passes); about 0.6 s on a laptop. */
export const ARGON2_DEFAULT: Argon2Params = { m: 32_768, t: 3, p: 1 };
export const ARGON2_MAX_MEMORY_KIB = 262_144;
export const ARGON2_MAX_PASSES = 12;

export interface PasswordSealed extends Argon2Params {
  v: 2;
  alg: 'AES-GCM';
  kdf: 'Argon2id';
  salt: string;
  iv: string;
  data: string;
}

export type CryptoErrorCode = 'unavailable' | 'wrong_password' | 'invalid_payload';

export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}

const SALT_BYTES = 16;
const IV_BYTES = 12;
const HKDF_ENC = 'aster/v2/aes-256-gcm';
const HKDF_VERIFY = 'aster/v2/password-check';

export function validArgon2(params: Argon2Params): boolean {
  const { m, t, p } = params;
  return (
    Number.isInteger(m) && Number.isInteger(t) && Number.isInteger(p) &&
    p >= 1 && p <= 8 && t >= 1 && t <= ARGON2_MAX_PASSES && m >= 8 * p && m <= ARGON2_MAX_MEMORY_KIB
  );
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new CryptoError('unavailable', 'Encryption is unavailable: open the app over HTTPS or through localhost.');
  return api;
}

/** The last master key, for a few seconds: checking a password and opening data that shares its salt is one derivation. */
const MASTER_TTL_MS = 15_000;
let recent: { id: string; master: Uint8Array<ArrayBuffer>; at: number } | null = null;

export function forgetDerivedKeys(): void {
  if (recent) wipe(recent.master);
  recent = null;
}

/** Argon2id of a password (NFKC-normalised: the same text typed on another system gives the same bytes). */
export async function stretch(password: string, salt: Uint8Array, params: Argon2Params, length = 32): Promise<Uint8Array<ArrayBuffer>> {
  if (!validArgon2(params)) throw new CryptoError('invalid_payload', 'The encrypted data is damaged.');
  const secret = utf8(password.normalize('NFKC'));
  // The async variant yields to the event loop between blocks, so the page stays responsive for the second it takes.
  const { argon2idAsync } = await import('@noble/hashes/argon2.js');
  try {
    return new Uint8Array(await argon2idAsync(secret, salt, { m: params.m, t: params.t, p: params.p, dkLen: length, asyncTick: 10 })) as Uint8Array<ArrayBuffer>;
  } finally {
    wipe(secret);
  }
}

async function master(password: string, salt: Uint8Array<ArrayBuffer>, params: Argon2Params): Promise<Uint8Array<ArrayBuffer>> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', new Uint8Array([...utf8(password.normalize('NFKC')), 0, ...salt, 0, ...utf8(`${params.m}/${params.t}/${params.p}`)])));
  const id = toBase64(digest);
  if (recent && recent.id === id && Date.now() - recent.at < MASTER_TTL_MS) return recent.master;
  forgetDerivedKeys();
  const key = await stretch(password, salt, params);
  recent = { id, master: key, at: Date.now() };
  return key;
}

/** HKDF-SHA256 of a key, for one purpose. */
export async function hkdfBits(key: Uint8Array, info: string, salt: Uint8Array = new Uint8Array(32), bits = 256): Promise<Uint8Array<ArrayBuffer>> {
  const base = await subtle().importKey('raw', key as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, info: utf8(info) }, base, bits));
}

export async function aesKeyFrom(bytes: Uint8Array, usages: KeyUsage[] = ['encrypt', 'decrypt']): Promise<CryptoKey> {
  return subtle().importKey('raw', bytes as Uint8Array<ArrayBuffer>, 'AES-GCM', false, usages);
}

export interface SealOptions {
  argon2?: Argon2Params;
  /** What the data is for; must be the same when opening. */
  aad?: string;
  /** Reuse this base64 salt (so a password check and sealed data share one derivation). */
  salt?: string;
}

export async function sealWithPassword(password: string, plaintext: Uint8Array<ArrayBuffer>, options: SealOptions = {}): Promise<PasswordSealed> {
  const params = options.argon2 ?? ARGON2_DEFAULT;
  const salt = options.salt !== undefined ? fromBase64(options.salt) : randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await aesKeyFrom(await hkdfBits(await master(password, salt, params), HKDF_ENC));
  const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(options.aad ?? '') }, key, plaintext);
  return { v: 2, alg: 'AES-GCM', kdf: 'Argon2id', m: params.m, t: params.t, p: params.p, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) };
}

/** @throws CryptoError `wrong_password` for a wrong password or context, or changed bytes; `invalid_payload` for a damaged envelope */
export async function openWithPassword(password: string, sealed: PasswordSealed, { aad }: { aad?: string } = {}): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed?.v !== 2 || sealed.kdf !== 'Argon2id' || !validArgon2(sealed)) throw new CryptoError('invalid_payload', 'The encrypted data is damaged.');
  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let data: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64(sealed.salt);
    iv = fromBase64(sealed.iv);
    data = fromBase64(sealed.data);
  } catch {
    throw new CryptoError('invalid_payload', 'The encrypted data is damaged.');
  }
  const key = await aesKeyFrom(await hkdfBits(await master(password, salt, sealed), HKDF_ENC));
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad ?? '') }, key, data));
  } catch {
    // GCM cannot tell a wrong key from changed bytes (or a wrong context); all are reported as one error on purpose.
    throw new CryptoError('wrong_password', 'Wrong password or the data is damaged.');
  }
}

export async function sealTextWithPassword(password: string, text: string, options?: SealOptions): Promise<PasswordSealed> {
  return sealWithPassword(password, utf8(text), options);
}

export async function openTextWithPassword(password: string, sealed: PasswordSealed, options?: { aad?: string }): Promise<string> {
  return new TextDecoder().decode(await openWithPassword(password, sealed, options));
}

// ───────── A check value for a lock screen ─────────

export interface PasswordCheck {
  salt: string;
  argon2: Argon2Params;
  /** Base64; independent of the encryption key (a different HKDF label) */
  verifier: string;
}

export async function createPasswordCheck(password: string, argon2: Argon2Params = ARGON2_DEFAULT, saltB64?: string): Promise<PasswordCheck> {
  const salt = saltB64 !== undefined ? fromBase64(saltB64) : randomBytes(SALT_BYTES);
  return { salt: toBase64(salt), argon2, verifier: toBase64(await hkdfBits(await master(password, salt, argon2), HKDF_VERIFY)) };
}

export async function checkPassword(password: string, stored: PasswordCheck): Promise<boolean> {
  const expected = fromBase64(stored.verifier);
  const actual = await hkdfBits(await master(password, fromBase64(stored.salt), stored.argon2), HKDF_VERIFY);
  return constantTimeEqual(expected, actual);
}
