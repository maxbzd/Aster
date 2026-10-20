import { parseAuthHash, hasStoredSession } from './auth'
import { cloudEnabled } from './config'
import { installTracking } from './engine'
import { setCloud } from './store'

/**
 * Runs at startup. Edit tracking is switched on at once, and the heavy part (sign-in, sync, the Supabase
 * library) is loaded only if the person has already signed in or arrived through a link from an email.
 */
export async function bootCloud(): Promise<void> {
  installTracking()
  if (!cloudEnabled()) return
  if (!hasStoredSession() && !parseAuthHash(window.location.hash)) return
  setCloud({ phase: 'starting' })
  try {
    await (await import('./cloud')).bootCloud()
  } catch {
    setCloud({ phase: 'offline' }) // for example, the chunk did not load offline: we try again on the next start
  }
}
