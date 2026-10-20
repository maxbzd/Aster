import { liveQuery } from 'dexie'
import { friendlyCloudError } from './auth'
import { engine as defaultEngine, type Engine, type Remote } from './engine'
import type { CloudState } from './store'
import { t } from '@/i18n'

export interface ControllerOptions {
  remote: Remote
  /** the engine over a specific database; the app's database by default */
  engine?: Engine
  userId: string
  report: (patch: Partial<CloudState>) => void
  /** a subscription to "something changed in the cloud" (Realtime); returns an unsubscribe */
  subscribe?: (ping: () => void) => () => void
  /** the pause after a local edit before sending */
  debounceMs?: number
  /** how often to check the cloud when no pings arrive */
  pollMs?: number
  /** react to a return to the app at most once per this many ms */
  focusThrottleMs?: number
  online?: () => boolean
  /** pauses before a retry after an error, ms */
  backoffMs?: number[]
}

export const BACKOFF = [3_000, 10_000, 30_000, 60_000, 180_000, 300_000]

/** One sync "session" for a signed-in user. */
export class SyncController {
  private inflight: Promise<void> | null = null
  private again: { full: boolean } | null = null
  private errors = 0
  private stopped = false
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private cleanups: Array<() => void> = []
  private lastRunAt = 0

  private e: Engine

  constructor(private o: ControllerOptions) {
    this.e = o.engine ?? defaultEngine
  }

  private online() {
    return this.o.online ? this.o.online() : typeof navigator === 'undefined' || navigator.onLine !== false
  }

  private later(fn: () => void, ms: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.stopped) fn() }, ms)
    this.timers.add(timer)
    return timer
  }

  /** Start: work out whose data this is, prepare the queue if needed and run the first sync. */
  async start() {
    const e = this.e
    e.installTracking()
    const stored = await e.getMeta<string>('userId')
    if (stored && stored !== this.o.userId) {
      // the device holds another account's data: they must not be mixed
      await e.clearLocalData()
      this.o.report({ notice: t("This device had another account's data — it was removed, loading yours.") })
    }
    if (stored !== this.o.userId && (await e.hasDemoData())) {
      // fictional people must not get into a real account
      await e.clearLocalData()
      this.o.report({ notice: t("Demo data was removed from the device so it doesn't reach the cloud.") })
    }
    if (stored !== this.o.userId) {
      await e.setMeta('userId', this.o.userId)
      await e.delMeta('cursor')
      if (await e.hasLocalData()) await e.enqueueAll()
    }
    if (this.stopped) return

    const sub = liveQuery(() => e.db.outbox.count()).subscribe({ next: pending => this.o.report({ pending }), error: () => undefined })
    this.cleanups.push(() => sub.unsubscribe())
    this.cleanups.push(e.onLocalChange(() => this.later(() => void this.syncNow(), this.o.debounceMs ?? 1200)))

    if (this.o.subscribe) {
      let pingTimer: ReturnType<typeof setTimeout> | undefined
      this.cleanups.push(this.o.subscribe(() => {
        clearTimeout(pingTimer)
        pingTimer = this.later(() => void this.syncNow(), 250)
      }))
    }

    if (typeof document !== 'undefined') {
      const wake = () => {
        if (document.visibilityState === 'hidden') return
        if (Date.now() - this.lastRunAt < (this.o.focusThrottleMs ?? 10_000)) return
        void this.syncNow()
      }
      document.addEventListener('visibilitychange', wake)
      window.addEventListener('online', wake)
      window.addEventListener('focus', wake)
      this.cleanups.push(() => {
        document.removeEventListener('visibilitychange', wake)
        window.removeEventListener('online', wake)
        window.removeEventListener('focus', wake)
      })
    }

    const poll = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void this.syncNow() }, this.o.pollMs ?? 60_000)
    this.cleanups.push(() => clearInterval(poll))

    await this.syncNow()
  }

  stop() {
    this.stopped = true
    for (const item of this.timers) clearTimeout(item)
    this.timers.clear()
    for (const c of this.cleanups.splice(0)) c()
  }

  /** Sync now. Never more than one at a time; extra requests collapse into one repeat. */
  syncNow(opts: { full?: boolean } = {}): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.inflight) {
      this.again = { full: !!(this.again?.full || opts.full) }
      return this.inflight
    }
    this.inflight = (async () => {
      let next: { full: boolean } | null = { full: !!opts.full }
      while (next && !this.stopped) {
        this.again = null
        await this.runOnce(next.full)
        next = this.errors ? null : this.again
      }
    })().finally(() => { this.inflight = null })
    return this.inflight
  }

  /** A full resync: everything local goes to the queue and the cloud is read from the very start. */
  async resync() {
    await this.e.clearRejected()
    await this.e.enqueueAll()
    return this.syncNow({ full: true })
  }

  private async runOnce(full: boolean) {
    this.lastRunAt = Date.now()
    if (!this.online()) {
      this.o.report({ phase: 'offline', pending: await this.e.pendingCount() })
      return
    }
    this.o.report({ phase: 'syncing' })
    try {
      await this.e.syncOnce(this.o.remote, { full })
      this.errors = 0
      this.o.report({ phase: 'idle', lastSyncAt: Date.now(), error: undefined, pending: await this.e.pendingCount(), rejected: await this.e.rejectedCount() })
    } catch (e) {
      if (this.stopped) return
      this.errors++
      const value = friendlyCloudError(e)
      const offline = !this.online() || value === t('No internet connection')
      this.o.report({ phase: offline ? 'offline' : 'error', error: offline ? undefined : value, pending: await this.e.pendingCount() })
      this.later(() => void this.syncNow({ full }), (this.o.backoffMs ?? BACKOFF)[Math.min(this.errors - 1, (this.o.backoffMs ?? BACKOFF).length - 1)])
    }
  }
}
