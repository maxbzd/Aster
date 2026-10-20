import type { OwnBridge } from './own'
import { decodePairing, encodePairing, hashToken, newToken } from './pairing'
import { peerAccept, peerDrop } from './peer'
import { BridgeError, SCOPES, type Connection, type Scope } from './protocol'
import { t } from '@/i18n'

/** Details of THIS app: what to call it in the other one and where it lives. */
export interface SelfInfo { label: string; url: string; key: string }

type Fetch = typeof fetch

/** Shows a pairing code: it is pasted in the other app. Valid for 10 minutes, one-time. */
export async function createPairingCode(own: OwnBridge, self: SelfInfo, scopes: Scope[] = [...SCOPES]) {
  const { code, expiresAt } = await own.createOffer(self.label, scopes)
  return { text: encodePairing({ u: self.url, k: self.key, c: code, l: self.label }), expiresAt }
}

/**
 * Accepts a code from the other app. The order matters: first an "incoming" key is created here (its hash),
 * then the code is exchanged for the other side's key. If something goes wrong, nothing is left here.
 */
export async function acceptPairingCode(own: OwnBridge, self: SelfInfo, text: string, scopes: Scope[] = [...SCOPES], fetchImpl?: Fetch): Promise<Connection['id']> {
  const p = decodePairing(text)
  if (p.u === self.url) throw new BridgeError('bad-code', t("This is this app's own code. Paste the code from the other app."))
  const token = newToken()
  const id = await own.register(await hashToken(token), scopes)
  try {
    const res = await peerAccept({ url: p.u, key: p.k }, { code: p.c, label: self.label, url: self.url, key: self.key, token }, fetchImpl)
    await own.complete(id, { label: res.label || p.l, url: p.u, key: p.k, token: res.token })
  } catch (e) {
    await own.disconnect(id).catch(() => undefined)
    throw e
  }
  return id
}

/** Disconnects on both sides. If the other side is unreachable, its key will stop working on its next request. */
export async function disconnectPeer(own: OwnBridge, c: Connection, fetchImpl?: Fetch): Promise<void> {
  if (c.outbound_token && c.peer_url && c.peer_key) await peerDrop({ url: c.peer_url, key: c.peer_key }, c.outbound_token, fetchImpl)
  await own.disconnect(c.id)
}
