import { aesKeyFrom, CryptoError, hkdfBits } from './password';
import { concat, fromBase64, randomBytes, toBase64, utf8, wipe } from './bytes';

/**
 * Sealing to a public key that stays safe against a quantum computer: a hybrid of X25519 and ML-KEM-768 (the NIST
 * standard for key encapsulation, FIPS 203). Both shared secrets go into one HKDF, so an attacker has to break BOTH:
 * the classical one today, the lattice one if a quantum computer ever appears. This matters for what is written down
 * and kept (backups in a cloud drive, a record in a cloud): "store now, decrypt later" is the realistic threat, and
 * the password-based AES-256 that protects the private key is not affected by quantum attacks in practice.
 *
 *   sealed = ephemeral X25519 key + ML-KEM ciphertext + AES-256-GCM(data), key = HKDF(x25519 ‖ ml-kem secrets,
 *            salt = every public value involved, info = purpose)
 */

export interface HybridPublicKey {
  /** X25519, 32 bytes */
  x: Uint8Array;
  /** ML-KEM-768, 1184 bytes */
  k: Uint8Array;
}

export interface HybridSecretKey {
  x: Uint8Array;
  /** ML-KEM-768 secret key, 2400 bytes */
  k: Uint8Array;
}

export interface HybridKeyPair {
  publicKey: HybridPublicKey;
  secretKey: HybridSecretKey;
}

export interface HybridSealed {
  v: 1;
  alg: 'X25519+ML-KEM-768/AES-256-GCM';
  /** ephemeral X25519 public key (base64) */
  epk: string;
  /** ML-KEM-768 ciphertext (base64) */
  ct: string;
  iv: string;
  data: string;
}

export const HYBRID_SEED_BYTES = 32 + 64;

const ALG = 'X25519+ML-KEM-768/AES-256-GCM';

async function curves() {
  return (await import('@noble/curves/ed25519.js')).x25519;
}
async function kem() {
  return (await import('@noble/post-quantum/ml-kem.js')).ml_kem768;
}

/** The same 96 bytes always give the same key pair: 32 for X25519, 64 for ML-KEM. */
export async function hybridKeyPairFromSeed(seed: Uint8Array): Promise<HybridKeyPair> {
  if (seed.length !== HYBRID_SEED_BYTES) throw new CryptoError('invalid_payload', 'The key seed has the wrong size.');
  const x25519 = await curves();
  const ml = await kem();
  const xs = seed.slice(0, 32);
  const kp = ml.keygen(seed.slice(32));
  return { publicKey: { x: x25519.getPublicKey(xs), k: kp.publicKey }, secretKey: { x: xs, k: kp.secretKey } };
}

export async function hybridKeyPairRandom(): Promise<HybridKeyPair> {
  const seed = randomBytes(HYBRID_SEED_BYTES);
  try {
    return await hybridKeyPairFromSeed(seed);
  } finally {
    wipe(seed);
  }
}

export const encodePublicKey = (key: HybridPublicKey): string => toBase64(concat(key.x, key.k));

export function decodePublicKey(text: string): HybridPublicKey {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(text);
  } catch {
    throw new CryptoError('invalid_payload', 'The public key is damaged.');
  }
  if (bytes.length !== 32 + 1184) throw new CryptoError('invalid_payload', 'The public key is damaged.');
  return { x: bytes.slice(0, 32), k: bytes.slice(32) };
}

async function derive(sharedX: Uint8Array, sharedK: Uint8Array, epk: Uint8Array, ct: Uint8Array, recipient: HybridPublicKey, aad: string): Promise<CryptoKey> {
  const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(epk, ct, recipient.x, recipient.k)));
  const ikm = concat(sharedX, sharedK);
  try {
    return await aesKeyFrom(await hkdfBits(ikm, `${ALG}|${aad}`, salt));
  } finally {
    wipe(ikm);
  }
}

/** Encrypts to the owner of `recipient`; only the matching secret key opens it. Needs no secret at all. */
export async function hybridSeal(recipient: HybridPublicKey, plaintext: Uint8Array<ArrayBuffer>, aad = ''): Promise<HybridSealed> {
  const x25519 = await curves();
  const ml = await kem();
  const esk = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const sharedX = x25519.getSharedSecret(esk, recipient.x);
  const { cipherText, sharedSecret } = ml.encapsulate(recipient.k);
  const key = await derive(sharedX, sharedSecret, epk, cipherText, recipient, aad);
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, plaintext);
  wipe(esk, sharedX, sharedSecret);
  return { v: 1, alg: ALG, epk: toBase64(epk), ct: toBase64(cipherText), iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) };
}

/** @throws CryptoError `wrong_password` for a wrong key or context or changed bytes, `invalid_payload` for a damaged envelope */
export async function hybridOpen(secret: HybridSecretKey, publicKey: HybridPublicKey, sealed: HybridSealed, aad = ''): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed?.v !== 1 || sealed.alg !== ALG) throw new CryptoError('invalid_payload', 'The encrypted data is damaged.');
  let epk: Uint8Array;
  let ct: Uint8Array;
  let iv: Uint8Array<ArrayBuffer>;
  let data: Uint8Array<ArrayBuffer>;
  try {
    epk = fromBase64(sealed.epk);
    ct = fromBase64(sealed.ct);
    iv = fromBase64(sealed.iv);
    data = fromBase64(sealed.data);
  } catch {
    throw new CryptoError('invalid_payload', 'The encrypted data is damaged.');
  }
  if (epk.length !== 32 || ct.length !== 1088) throw new CryptoError('invalid_payload', 'The encrypted data is damaged.');
  const x25519 = await curves();
  const ml = await kem();
  try {
    const sharedX = x25519.getSharedSecret(secret.x, epk);
    // ML-KEM decapsulation never fails on a wrong ciphertext (it returns a pseudo-random secret): the GCM tag decides.
    const sharedK = ml.decapsulate(ct, secret.k);
    const key = await derive(sharedX, sharedK, epk, ct, publicKey, aad);
    wipe(sharedX, sharedK);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, data));
  } catch {
    throw new CryptoError('wrong_password', 'Wrong key or the data is damaged.');
  }
}

/** The hybrid key pair that a passphrase stands for: Argon2id of the passphrase gives the 96-byte seed. */
export async function hybridKeyPairFromPassphrase(passphrase: string, salt: Uint8Array, params: import('./password').Argon2Params): Promise<HybridKeyPair> {
  const { stretch } = await import('./password');
  const seed = await stretch(passphrase, salt, params, HYBRID_SEED_BYTES);
  try {
    return await hybridKeyPairFromSeed(seed);
  } finally {
    wipe(seed);
  }
}
