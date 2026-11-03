import { fromBase64, toBase64, utf8 } from '@/crypto/bytes'
import { aesKeyFrom, hkdfBits } from '@/crypto/password'
import { newRecoveryKey, parseRecoveryKey } from '@/vault/keys'

/**
 * End-to-end encryption of the cloud copy. One random 256-bit key (the "cloud key") lives on your devices; every record
 * is sealed with it before it leaves, so the server stores only an envelope it cannot read, and neither can anyone who
 * gets into the server. Merging (src/cloud/merge.ts) happens on the devices, after opening, so nothing about syncing changes.
 *
 * What the server still sees: which table and id a record belongs to, when it changed, and its size.
 * What stops working: anything that reads records on the server (the MCP server for Claude, the Orbita bridge, TickTick).
 *
 * A new device gets the key from an old one (src/crypto/pairing.ts: hybrid, quantum-safe) or from the recovery key
 * written down when this was turned on. Lose every device and the recovery key, and the cloud copy is unreadable by design.
 */

export const CLOUD_KEY_PURPOSE = 'aster/cloud-key'

export interface CloudKey {
  /** short, public: tells which key sealed a record */
  id: string
  key: CryptoKey
}

export interface Envelope {
  _e2e: 1
  k: string
  iv: string
  c: string
}

export const isEnvelope = (v: unknown): v is Envelope => !!v && typeof v === 'object' && (v as Envelope)._e2e === 1 && typeof (v as Envelope).c === 'string'

/** The AES key for records comes from the cloud key through HKDF, so the raw key is never used directly. */
export async function importCloudKey(raw: Uint8Array): Promise<CloudKey> {
  const id = toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', raw as Uint8Array<ArrayBuffer>)).slice(0, 6))
  return { id, key: await aesKeyFrom(await hkdfBits(raw, 'aster/cloud/record-key')) }
}

const aadOf = (tbl: string, id: string) => utf8(`aster/cloud/${tbl}/${id}`)

export async function sealRecord(k: CloudKey, tbl: string, id: string, data: Record<string, unknown>): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(tbl, id) }, k.key, utf8(JSON.stringify(data)))
  return { _e2e: 1, k: k.id, iv: toBase64(iv), c: toBase64(new Uint8Array(sealed)) }
}

/** `null` when it does not open with this key (another key, a changed record, or a record moved to another place). */
export async function openRecord(k: CloudKey, tbl: string, id: string, env: Envelope): Promise<Record<string, unknown> | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv), additionalData: aadOf(tbl, id) }, k.key, fromBase64(env.c))
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** A new cloud key, and the text to write down for it (the same format as the vault's recovery key, with a check). */
export async function makeCloudKey(): Promise<{ raw: Uint8Array<ArrayBuffer>; text: string }> {
  const { bytes, text } = await newRecoveryKey()
  return { raw: bytes, text }
}

export const cloudKeyFromText = (text: string): Promise<Uint8Array<ArrayBuffer> | null> => parseRecoveryKey(text)
