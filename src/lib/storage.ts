/**
 * Where the data lives and how safe that place is.
 *
 * Safari on iPhone and iPad deletes everything a website stored (IndexedDB, localStorage, caches) when the site has not
 * been opened for 7 days of Safari use. An app added to the Home Screen is exempt, and asking for persistent storage
 * helps on other browsers. Nothing on the page can detect that the deletion happened (the evidence is erased together
 * with the data), so the only protection is to install the app first and to keep backups.
 */

export type InstallState =
  /** Safari (or another iOS browser) in a tab: the data can be deleted after 7 idle days. */
  | 'ios-browser'
  /** Opened from the Home Screen / installed: exempt from that rule. */
  | 'installed'
  /** Any other browser, tab or desktop. */
  | 'browser'

export interface Env {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
  /** `navigator.standalone` (iOS) */
  standalone?: boolean
  /** `matchMedia('(display-mode: standalone)')` */
  displayStandalone?: boolean
}

export function currentEnv(): Env {
  if (typeof navigator === 'undefined') return { userAgent: '' }
  const nav = navigator as Navigator & { standalone?: boolean }
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone === true,
    displayStandalone: typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
  }
}

/** iPhone, iPod, and iPad (which pretends to be a Mac since iPadOS 13: a "Mac" with a touch screen). */
export function isIos(env: Env = currentEnv()): boolean {
  if (/iPad|iPhone|iPod/i.test(env.userAgent)) return true
  return env.platform === 'MacIntel' && (env.maxTouchPoints ?? 0) > 1
}

export function installState(env: Env = currentEnv()): InstallState {
  if (env.standalone || env.displayStandalone) return 'installed'
  return isIos(env) ? 'ios-browser' : 'browser'
}

/** True when the browser may delete this site's data after a week of inactivity. */
export const isDataAtRisk = (env: Env = currentEnv()): boolean => installState(env) === 'ios-browser'

/** Asks the browser not to evict the data. Resolves to whether storage is persistent now. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    return false
  }
}

// ───────── The reminder to install ─────────

const NUDGE_KEY = 'aster.installNudgeUntil'
const NUDGE_SNOOZE_MS = 3 * 86_400_000

/** Whether to show the "add to Home Screen" reminder now (per device, so it is not synced). */
export function installNudgeDue(now: number = Date.now(), env: Env = currentEnv()): boolean {
  if (!isDataAtRisk(env)) return false
  try {
    return now >= Number(localStorage.getItem(NUDGE_KEY) ?? 0)
  } catch {
    return true
  }
}

/** Hides the reminder for three days; it comes back until the app is installed. */
export function snoozeInstallNudge(now: number = Date.now()): void {
  try {
    localStorage.setItem(NUDGE_KEY, String(now + NUDGE_SNOOZE_MS))
  } catch {
    // storage blocked: the reminder simply stays
  }
}
