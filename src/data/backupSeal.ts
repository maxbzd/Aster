import { fromUtf8, fromBase64, randomBytes, toBase64, utf8 } from '@/crypto/bytes'
import { decodePublicKey, encodePublicKey, hybridKeyPairFromPassphrase, hybridOpen, hybridSeal } from '@/crypto/hybrid'
import { ARGON2_DEFAULT, CryptoError, openTextWithPassword, sealTextWithPassword, validArgon2, type Argon2Params } from '@/crypto/password'
import type { EncryptedBackupFile, KeyBackupFile, PasswordBackupFile } from './backupFormat'
import type { AutoBackupSettings } from './types'

/**
 * Encrypted backup files. The plain backup (see `exportBackup`) is sealed one of two ways:
 *
 *  - `password`: a password typed when the file is made (Argon2id → AES-256-GCM);
 *  - `key`: an automatic copy, sealed to a public key (X25519 + ML-KEM-768) kept on the device. Making it needs no
 *    secret; opening it needs the passphrase that the key pair was made from.
 *
 * The purpose is authenticated in both, so a backup cannot be passed off as anything else.
 */

export const BACKUP_AAD = 'aster/backup/v1'

export { isEncryptedBackup } from './backupFormat'
export type { EncryptedBackupFile, KeyBackupFile, PasswordBackupFile } from './backupFormat'

export async function sealBackupWithPassword(plain: object, password: string, argon2: Argon2Params = ARGON2_DEFAULT): Promise<PasswordBackupFile> {
  const exportedAt = String((plain as { exportedAt?: unknown }).exportedAt ?? new Date().toISOString())
  return { app: 'aster', encrypted: 'password', version: 1, exportedAt, sealed: await sealTextWithPassword(password, JSON.stringify(plain), { argon2, aad: BACKUP_AAD }) }
}

/** Sets up automatic copies: the passphrase becomes a key pair; only the public half is kept. */
export async function createAutoBackupKey(passphrase: string, argon2: Argon2Params = ARGON2_DEFAULT): Promise<Pick<AutoBackupSettings, 'salt' | 'm' | 't' | 'p' | 'publicKey'>> {
  const salt = randomBytes(16)
  const pair = await hybridKeyPairFromPassphrase(passphrase, salt, argon2)
  return { salt: toBase64(salt), ...argon2, publicKey: encodePublicKey(pair.publicKey) }
}

export async function sealBackupToKey(plain: object, config: Pick<AutoBackupSettings, 'salt' | 'm' | 't' | 'p' | 'publicKey'>): Promise<KeyBackupFile> {
  const exportedAt = String((plain as { exportedAt?: unknown }).exportedAt ?? new Date().toISOString())
  const sealed = await hybridSeal(decodePublicKey(config.publicKey), utf8(JSON.stringify(plain)), BACKUP_AAD)
  return { app: 'aster', encrypted: 'key', version: 1, exportedAt, kdf: { m: config.m, t: config.t, p: config.p, salt: config.salt }, sealed }
}

/** Opens a backup with the password (or passphrase) and returns the plain backup. @throws CryptoError */
export async function openBackup(file: EncryptedBackupFile, secret: string): Promise<unknown> {
  let text: string
  if (file.encrypted === 'password') {
    text = await openTextWithPassword(secret, file.sealed, { aad: BACKUP_AAD })
  } else {
    const { salt, ...params } = file.kdf ?? ({} as Argon2Params & { salt: string })
    if (!validArgon2(params) || typeof salt !== 'string') throw new CryptoError('invalid_payload', 'The encrypted data is damaged.')
    let saltBytes: Uint8Array
    try { saltBytes = fromBase64(salt) } catch { throw new CryptoError('invalid_payload', 'The encrypted data is damaged.') }
    const pair = await hybridKeyPairFromPassphrase(secret, saltBytes, params)
    text = fromUtf8(await hybridOpen(pair.secretKey, pair.publicKey, file.sealed, BACKUP_AAD))
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new CryptoError('invalid_payload', 'The encrypted data is damaged.')
  }
}
