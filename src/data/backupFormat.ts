import type { HybridSealed } from '@/crypto/hybrid'
import type { Argon2Params, PasswordSealed } from '@/crypto/password'

/** The shape of an encrypted backup file. Kept apart from the crypto so that the screens can recognise one without loading it. */
export interface PasswordBackupFile {
  app: 'aster'
  encrypted: 'password'
  version: 1
  exportedAt: string
  sealed: PasswordSealed
}

export interface KeyBackupFile {
  app: 'aster'
  encrypted: 'key'
  version: 1
  exportedAt: string
  /** how the passphrase becomes the key pair */
  kdf: Argon2Params & { salt: string }
  sealed: HybridSealed
}

export type EncryptedBackupFile = PasswordBackupFile | KeyBackupFile

export function isEncryptedBackup(value: unknown): value is EncryptedBackupFile {
  const v = value as { app?: unknown; encrypted?: unknown; sealed?: unknown } | null
  return !!v && typeof v === 'object' && v.app === 'aster' && (v.encrypted === 'password' || v.encrypted === 'key') && typeof v.sealed === 'object' && v.sealed !== null
}
