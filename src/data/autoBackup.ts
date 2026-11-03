import { db } from './db'
import { exportBackup, saveSettings } from './actions'
import { sealBackupToKey } from './backupSeal'
import { folderAccess, writeToFolder } from '@/lib/folder'

export const AUTO_BACKUP_PREFIX = 'aster-auto-'
const KEEP = 14
const DAY = 86_400_000

export type AutoBackupResult = 'off' | 'not-due' | 'needs-permission' | 'written' | 'failed'

let running = false

/**
 * Writes an encrypted copy into the chosen folder if one is due. It needs no secret: the copy is sealed to the public
 * key set up with the passphrase. If the browser has not kept the folder permission (it asks again after a restart on
 * some systems), nothing is written and the profile screen offers one tap to allow it.
 */
export async function runAutoBackup({ force = false, now = Date.now() }: { force?: boolean; now?: number } = {}): Promise<AutoBackupResult> {
  if (running) return 'not-due'
  const cfg = (await db.settings.get('me'))?.autoBackup
  if (!cfg) return 'off'
  if (!force && cfg.lastAt && now - cfg.lastAt < cfg.everyDays * DAY) return 'not-due'
  running = true
  try {
    if ((await folderAccess()) !== 'granted') return 'needs-permission'
    const file = await sealBackupToKey(await exportBackup(), cfg)
    const day = new Date(now).toISOString().slice(0, 10)
    await writeToFolder(`${AUTO_BACKUP_PREFIX}${day}.aster.json`, JSON.stringify(file), AUTO_BACKUP_PREFIX, KEEP)
    const me = await db.settings.get('me')
    if (me?.autoBackup) await saveSettings({ autoBackup: { ...me.autoBackup, lastAt: now }, lastBackupAt: now })
    return 'written'
  } catch {
    return 'failed'
  } finally {
    running = false
  }
}
