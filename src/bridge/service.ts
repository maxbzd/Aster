import { t } from '@/i18n'
import { onLocalChange } from '@/cloud/engine'
import { getClient } from '@/cloud/auth'
import { SUPABASE_KEY, SUPABASE_URL } from '@/cloud/config'
import { acceptPairingCode, createPairingCode, disconnectPeer, type SelfInfo } from './connect'
import { bridgeCycle, buildLinkMap, type MetaStore } from './cycle'
import { setBridge } from './store'
import { asterAdapter } from './asterAdapter'
import { supabaseOwn, type OwnBridge } from './own'
import { describeBridgeError, SCOPES, type Connection, type Scope } from './protocol'
import { bridgeMeta } from './cache'

export const SELF: SelfInfo = { label: 'Aster', url: SUPABASE_URL, key: SUPABASE_KEY }

const set = setBridge

let own: OwnBridge | null = null
let meta: MetaStore = bridgeMeta
let running: Promise<void> | null = null
let again = false
let timers: Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>> = []
let cleanups: Array<() => void> = []

async function ownBridge(): Promise<OwnBridge> {
  own ??= supabaseOwn(await getClient())
  return own
}

/** Подставить свои реализации (в тестах). */
export function __setBridgeDeps(d: { own?: OwnBridge | null; meta?: MetaStore }) {
  if (d.own !== undefined) own = d.own
  if (d.meta) meta = d.meta
}

export async function refreshConnections(): Promise<Connection[]> {
  const conns = await (await ownBridge()).listConnections()
  set({ connections: conns })
  return conns
}

/** Один круг обмена. Параллельные вызовы схлопываются в один повтор. */
export function runBridge(): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    do {
      again = false
      set({ phase: 'syncing' })
      try {
        const o = await ownBridge()
        const report = await bridgeCycle({ own: o, adapter: asterAdapter, meta })
        const conns = await o.listConnections()
        const bad = report.peers.find(p => p.status === 'revoked')
        const off = report.peers.some(p => p.status === 'offline')
        const err = report.peers.find(p => p.status === 'error')
        set({ connections: conns, report, lastCycleAt: Date.now(), revoked: !!bad, phase: off ? 'offline' : err ? 'error' : 'idle', error: err?.error })
      } catch (e) {
        const value = describeBridgeError(e)
        set({ phase: value === t('No internet connection') ? 'offline' : 'error', error: value })
      }
    } while (again)
  })().finally(() => { running = null })
  return running
}

/** Запуск вместе со входом в облако: первый круг, затем по расписанию, при возвращении в приложение и после правок. */
export function startBridge() {
  stopBridge()
  set({ active: true })
  void runBridge()
  let debounce: ReturnType<typeof setTimeout> | undefined
  cleanups.push(onLocalChange(() => { clearTimeout(debounce); debounce = setTimeout(() => void runBridge(), 4000) }))
  if (typeof document !== 'undefined') {
    const wake = () => { if (document.visibilityState !== 'hidden') void runBridge() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    cleanups.push(() => { document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake) })
  }
  timers.push(setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void runBridge() }, 60_000))
}

export function stopBridge() {
  for (const item of timers.splice(0)) clearInterval(item as ReturnType<typeof setInterval>)
  for (const c of cleanups.splice(0)) c()
  own = null
  set({ active: false, connections: [], phase: 'idle', revoked: false, error: undefined, report: undefined, lastCycleAt: undefined })
}

/* ---------- действия экрана ---------- */

export async function makeCode() {
  const r = await createPairingCode(await ownBridge(), SELF)
  await refreshConnections()
  return r
}

export async function enterCode(text: string) {
  await acceptPairingCode(await ownBridge(), SELF, text)
  await refreshConnections()
  void runBridge()
}

export async function disconnect(c: Connection) {
  await disconnectPeer(await ownBridge(), c)
  await refreshConnections()
  await meta.set(`cursor:${c.id}`, 0)
}

export async function changeScopes(c: Connection, scopes: Scope[]) {
  await (await ownBridge()).setScopes(c.id, scopes.filter(s => SCOPES.includes(s)))
  await refreshConnections()
}

/** Связать человека в Aster с человеком в Орбите вручную. Сразу публикуется, чтобы другая сторона узнала. */
export async function linkPeople(localId: string, peerId: string) {
  const o = await ownBridge()
  await o.putLinks([{ local_id: localId, peer_id: peerId, origin: 'user', deleted: false, updated_ms: Date.now() }])
  await runBridge()
}

export async function unlinkPeople(localId: string, peerId: string) {
  const o = await ownBridge()
  await o.putLinks([{ local_id: localId, peer_id: peerId, origin: 'user', deleted: true, updated_ms: Date.now() }])
  await runBridge()
}

export { buildLinkMap }
