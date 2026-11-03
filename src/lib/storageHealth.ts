import { create } from 'zustand'

/**
 * What the app knows about the room left for its data. Two things matter:
 *
 *  - a write that the browser refused because the storage is full (`QuotaExceededError`): the change was NOT saved, and
 *    the person must be told at once, not left to find out later that something is missing;
 *  - how close to the limit the storage is, so the warning comes before the first refusal.
 *
 * Kept free of heavy imports: the database layer reports into it, and the screens read it.
 */

export interface StorageHealth {
  /** a write was refused for lack of room and not yet dealt with */
  full: boolean
  failedAt: number | null
  /** bytes in use and the browser's allowance for this site; `null` when the browser does not say */
  usage: number | null
  quota: number | null
  /** the person closed the notice; it comes back at the next refusal or when usage climbs further */
  dismissed: boolean
}

export const useStorageHealth = create<StorageHealth>(() => ({ full: false, failedAt: null, usage: null, quota: null, dismissed: false }))

/** The browsers name it differently: the standard name, Firefox's own, and the legacy code numbers; Dexie wraps the original. */
export function isQuotaError(error: unknown): boolean {
  let e = error as { name?: string; code?: number; message?: string; inner?: unknown; cause?: unknown } | null | undefined
  for (let depth = 0; e && typeof e === 'object' && depth < 5; depth += 1) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014) return true
    if (/quota/i.test(String(e.message ?? ''))) return true
    e = (e.inner ?? e.cause) as typeof e
  }
  return false
}

/** Called by the database layer for every failed write. Returns whether it was a lack of room. */
export function reportWriteFailure(error: unknown): boolean {
  if (!isQuotaError(error)) return false
  useStorageHealth.setState({ full: true, failedAt: Date.now(), dismissed: false })
  void refreshEstimate()
  return true
}

/** The person made room (or chose to go on): the notice goes away until the next refusal. */
export function resolveFull(): void {
  useStorageHealth.setState({ full: false, dismissed: false })
}

export function dismissNotice(): void {
  useStorageHealth.setState({ dismissed: true })
}

export async function refreshEstimate(): Promise<void> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate) return
    useStorageHealth.setState({ usage: estimate.usage ?? null, quota: estimate.quota ?? null })
  } catch {
    // the browser does not say: only a refused write will raise the alarm
  }
}

export type StorageLevel = 'ok' | 'almost' | 'full'

/** `almost` from 90 % of the allowance, or when under 25 MB is left; the browser's own figure is the only judge. */
export function storageLevel(s: Pick<StorageHealth, 'full' | 'usage' | 'quota'>): StorageLevel {
  if (s.full) return 'full'
  if (s.usage === null || s.quota === null || s.quota <= 0) return 'ok'
  return s.usage / s.quota >= 0.9 || s.quota - s.usage < 25 * 1024 * 1024 ? 'almost' : 'ok'
}
