import { create } from 'zustand'

/**
 * A new version of the app. It is downloaded in the background and then waits: it is never swapped in under someone's hands
 * (a reload would drop a half-written note or cut a dictation, and the old screens would lose their files). The person is
 * told, and chooses the moment; otherwise it takes over at the next launch. The app also asks the server for a new version
 * when it comes back to the front and every hour, because an installed app can stay open for weeks.
 */

interface UpdateState {
  ready: boolean
  /** Reloads into the new version. */
  apply: (() => void) | null
}

export const useUpdate = create<UpdateState>(() => ({ ready: false, apply: null }))

const CHECK_EVERY_MS = 60 * 60_000

export function startUpdates(): void {
  if (!import.meta.env.PROD) return // the service worker only exists in production builds
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        useUpdate.setState({ ready: true, apply: () => void update(true) })
      },
      onRegisteredSW(_url, registration) {
        if (!registration) return
        const check = () => { if (document.visibilityState === 'visible') void registration.update().catch(() => undefined) }
        window.setInterval(check, CHECK_EVERY_MS)
        document.addEventListener('visibilitychange', check)
      },
    })
  })
}
