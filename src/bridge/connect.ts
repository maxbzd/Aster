import type { OwnBridge } from './own'
import { decodePairing, encodePairing, hashToken, newToken } from './pairing'
import { peerAccept, peerDrop } from './peer'
import { BridgeError, SCOPES, type Connection, type Scope } from './protocol'
import { t } from '@/i18n'

/** Сведения о ЭТОМ приложении: как его назвать у другого и где оно живёт. */
export interface SelfInfo { label: string; url: string; key: string }

type Fetch = typeof fetch

/** Показывает код подключения: его вставляют в другом приложении. Действует 10 минут, одноразовый. */
export async function createPairingCode(own: OwnBridge, self: SelfInfo, scopes: Scope[] = [...SCOPES]) {
  const { code, expiresAt } = await own.createOffer(self.label, scopes)
  return { text: encodePairing({ u: self.url, k: self.key, c: code, l: self.label }), expiresAt }
}

/**
 * Принимает код из другого приложения. Порядок важен: сначала у себя заводится «входящий» ключ (его хэш),
 * потом код меняется на ключ другой стороны. Если что-то пошло не так, у себя ничего не остаётся.
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

/** Отключает подключение с обеих сторон. Если другая сторона недоступна, у неё ключ перестанет работать при следующем обращении. */
export async function disconnectPeer(own: OwnBridge, c: Connection, fetchImpl?: Fetch): Promise<void> {
  if (c.outbound_token && c.peer_url && c.peer_key) await peerDrop({ url: c.peer_url, key: c.peer_key }, c.outbound_token, fetchImpl)
  await own.disconnect(c.id)
}
