import { liveQuery } from 'dexie'
import { useSyncExternalStore } from 'react'
import { db } from '@/data/db'
import { toggleReminder } from '@/data/actions'
import { cloudEnabled } from '@/cloud/config'
import { useCloud } from '@/cloud/store'
import { connectUrl, disconnect as apiDisconnect, getStatus, sync, type TickStatus } from './api'
import { buildPayload, idOf } from './payload'
import { t } from '@/i18n'

/* The TickTick link: Aster's reminders go to TickTick, and "done" travels both ways. Works while the app is open. */

export interface TickState {
  phase: 'off' | 'checking' | 'idle' | 'syncing' | 'error'
  status: TickStatus | null
  /** the person must connect again (the token is invalid) */
  expired: boolean
  lastSyncAt?: number
  /** how many tasks went to TickTick in the last exchange */
  created: number
  error?: string
}

let state: TickState = { phase: 'off', status: null, expired: false, created: 0 }
const listeners = new Set<() => void>()
const set = (patch: Partial<TickState>) => { state = { ...state, ...patch }; for (const l of listeners) l() }
export const getTickState = () => state
export const useTick = () => useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, getTickState)

let running = false
let again = false

/** One exchange: learn the state, send new reminders and "done", apply "done" from TickTick. */
export async function syncNow(): Promise<void> {
  if (running) { again = true; return }
  running = true
  try {
    set({ phase: 'checking' })
    const status = await getStatus()
    if (!status) { set({ phase: 'error', error: t('No connection to the server') }); return }
    set({ status })
    if (!status.configured || !status.connected) { set({ phase: 'idle' }); return }
    // demo data is not sent to TickTick: these are made-up reminders
    if ((await db.settings.get('me'))?.demo) { set({ phase: 'idle' }); return }
    const [reminders, people] = await Promise.all([db.reminders.toArray(), db.people.toArray()])
    set({ phase: 'syncing' })
    const res = await sync(buildPayload(reminders, people))
    if (!res.ok) {
      if (res.reason === 'expired' || res.reason === 'not_connected') { set({ phase: 'idle', expired: res.reason === 'expired', status: { ...status, connected: false } }); return }
      set({ phase: 'error', error: res.message ?? t('Sync failed') })
      return
    }
    for (const key of res.reply.completed) {
      const id = idOf(key)
      if (!id) continue
      const r = await db.reminders.get(id)
      if (r && !r.done) await toggleReminder(id)
    }
    set({ phase: 'idle', expired: false, lastSyncAt: Date.now(), created: res.reply.created, error: res.reply.errors[0] })
  } catch (e) {
    set({ phase: 'error', error: (e as Error).message })
  } finally {
    running = false
    if (again) { again = false; setTimeout(() => void syncNow(), 1500) }
  }
}

export async function startConnect(): Promise<void> {
  const url = await connectUrl(`${location.origin}${location.pathname}#/me`)
  location.assign(url)
}

export async function disconnect(): Promise<void> {
  await apiDisconnect()
  set({ status: state.status ? { ...state.status, connected: false } : null, expired: false })
}

/** The return from TickTick: the address contains ?ticktick=ok. The address is cleaned and the result is handed to the caller. */
export function takeReturnResult(): string | null {
  const url = new URL(location.href)
  const r = url.searchParams.get('ticktick')
  if (!r) return null
  url.searchParams.delete('ticktick')
  history.replaceState(null, '', url.toString())
  return r
}

const RETURN_TEXT: Record<string, string> = {
  get ok() { return t('TickTick connected') },
  get denied() { return t('TickTick access was not granted') },
  get token() { return t("TickTick didn't grant access. Try again") },
  get state() { return t('The connection link has expired. Try again') },
  get config() { return t("TickTick isn't set up on the server yet") },
}
export const returnText = (r: string) => RETURN_TEXT[r] ?? t("Couldn't connect TickTick")

let installed = false
/** Runs once at startup: after the cloud sign-in it watches the reminders and checks with TickTick once a minute. */
export function installTickTick(): void {
  if (installed || typeof window === 'undefined' || !cloudEnabled()) return
  installed = true
  let timer: ReturnType<typeof setInterval> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let sub: { unsubscribe(): void } | undefined
  const schedule = (ms: number) => { clearTimeout(debounce); debounce = setTimeout(() => void syncNow(), ms) }
  const onVisible = () => { if (!document.hidden) schedule(500) }

  const start = () => {
    void syncNow()
    timer = setInterval(() => { if (!document.hidden && navigator.onLine) void syncNow() }, 60_000)
    // any edit of reminders goes to TickTick in a couple of seconds
    let first = true
    sub = liveQuery(() => db.reminders.toArray()).subscribe({ next: () => { if (first) { first = false; return } schedule(2500) }, error: () => undefined })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
  }
  const stop = () => {
    clearInterval(timer); clearTimeout(debounce); sub?.unsubscribe()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onVisible)
    set({ phase: 'off', status: null, expired: false })
  }

  let on = false
  const apply = (userId: string | null) => {
    if (userId && !on) { on = true; start() }
    else if (!userId && on) { on = false; stop() }
  }
  apply(useCloud.getState().userId ?? null)
  useCloud.subscribe(s => apply(s.userId ?? null))
}
