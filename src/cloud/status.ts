import { ago } from '@/lib/format'
import type { CloudState } from './store'
import { t, tn } from '@/i18n'

export function statusLine(c: Pick<CloudState, 'phase' | 'lastSyncAt' | 'pending' | 'error'>): { text: string; tone: 'ok' | 'busy' | 'warn' | 'bad' } {
  switch (c.phase) {
    case 'starting': return { text: t('Connecting to the cloud…'), tone: 'busy' }
    case 'syncing': return { text: c.pending ? t('Syncing · {pl}', { pl: tn(c.pending, '{n} change', '{n} changes') }) : t('Syncing…'), tone: 'busy' }
    case 'offline': return { text: c.pending ? t('Offline · {pl} waiting to send', { pl: tn(c.pending, '{n} change', '{n} changes') }) : t('Offline · everything is saved on the device'), tone: 'warn' }
    case 'error': return { text: c.error ?? t("Couldn't sync"), tone: 'bad' }
    case 'idle': return { text: c.lastSyncAt ? t('All synced · {syncedAgo}', { syncedAgo: syncedAgo(c.lastSyncAt) }) : t('All synced'), tone: 'ok' }
    default: return { text: t('Not connected'), tone: 'warn' }
  }
}

/** "just now", "5 min ago", and past that an ordinary date. */
export function syncedAgo(value: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - value) / 1000))
  if (s < 45) return t('just now')
  if (s < 3600) return t('{max} min ago', { max: Math.max(1, Math.round(s / 60)) })
  return ago(value, now)
}
