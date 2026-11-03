import { fromBase64, toBase64 } from '@/crypto/bytes'
import { CLOUD_KEY_PURPOSE, importCloudKey, makeCloudKey, cloudKeyFromText } from './e2e'
import { readJoinRequest, finishJoin, startJoin, type JoinRequest } from '@/crypto/pairing'
import { formatRecoveryKey } from '@/vault/keys'
import { saveSettings } from '@/data/actions'
import { db } from '@/data/db'
import { delMeta } from './engine'
import { reencryptCloud, syncNow } from './cloud'

/** Turning cloud encryption on, and moving the key between devices. The key lives only in this device's settings. */

async function store(raw: Uint8Array): Promise<void> {
  await saveSettings({ e2e: { key: toBase64(raw), id: (await importCloudKey(raw)).id } })
}

/** Makes a key, seals the whole cloud copy with it and returns the recovery key to write down. */
export async function enableCloudEncryption(): Promise<string> {
  const made = await makeCloudKey()
  await store(made.raw)
  await delMeta('e2eMismatch')
  await reencryptCloud()
  return made.text
}

const rawKey = async (): Promise<Uint8Array<ArrayBuffer> | null> => {
  const k = (await db.settings.get('me'))?.e2e?.key
  return k ? fromBase64(k) : null
}

/** The recovery key again, for someone who wants to see it or write it down a second time. */
export async function cloudRecoveryText(): Promise<string | null> {
  const raw = await rawKey()
  return raw ? formatRecoveryKey(raw) : null
}

/** This device is joining an encrypted account with the key in hand: from the recovery key, or from another device. */
export async function joinWithKey(raw: Uint8Array): Promise<void> {
  await store(raw)
  // the records were skipped while there was no key: read the cloud again from the start
  await Promise.all([delMeta('cursor'), delMeta('e2eMismatch')])
  await syncNow()
}

export async function joinWithRecoveryText(text: string): Promise<boolean> {
  const raw = await cloudKeyFromText(text)
  if (!raw) return false
  await joinWithKey(raw)
  return true
}

// ---- the two sides of "add a device" ----

/** The new device: makes the request to show, then waits for the answer. */
export const beginJoin = (): Promise<JoinRequest> => startJoin()

export async function completeJoin(request: JoinRequest, answerCode: string): Promise<void> {
  await joinWithKey(await finishJoin(request, answerCode, CLOUD_KEY_PURPOSE))
}

/** The old device: reads the new device's code (and shows the check digits), then makes the answer to give back. */
export async function answerJoin(requestCode: string): Promise<{ checkDigits: string; answer(): Promise<string> }> {
  const raw = await rawKey()
  if (!raw) throw new Error('This device has no cloud key.')
  const read = await readJoinRequest(requestCode)
  return { checkDigits: read.checkDigits, answer: () => read.seal(raw, CLOUD_KEY_PURPOSE) }
}
