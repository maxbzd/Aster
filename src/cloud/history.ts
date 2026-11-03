import { db } from '@/data/db'
import { clearConflicts, conflictLog, setMeta, type ConflictEntry } from './engine'

/**
 * The edits that lost: when two devices change the same field differently, the newer one wins and the older value goes
 * to a log (see engine.ts). This is how a person gets one back.
 */

export type RestoreResult = 'restored' | 'gone' | 'unsupported'

/** Where a path can be written back. Paths into a list item (`topics[id:…].text`) and clipped values cannot. */
export function canRestore(entry: ConflictEntry): boolean {
  if (entry.path.includes('[') || entry.path === '') return false
  if (typeof entry.lost === 'string' && entry.lost.endsWith('…') && entry.lost.length >= 4000) return false
  return true
}

function setAt(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.')
  const root = structuredClone(target)
  let node = root
  for (const key of keys.slice(0, -1)) {
    const next = node[key]
    node[key] = next && typeof next === 'object' && !Array.isArray(next) ? { ...(next as object) } : {}
    node = node[key] as Record<string, unknown>
  }
  const last = keys[keys.length - 1]!
  if (value === undefined || value === null) delete node[last]
  else node[last] = value
  return root
}

/** Writes the lost value back (as a new edit, so it syncs like any other) and removes the entry from the log. */
export async function restoreLostValue(entry: ConflictEntry): Promise<RestoreResult> {
  if (!canRestore(entry)) return 'unsupported'
  const table = db.table(entry.table)
  const row = (await table.get(entry.id)) as Record<string, unknown> | undefined
  if (!row) return 'gone'
  const next = setAt(row, entry.path, entry.lost)
  if (typeof row.updatedAt === 'number') next.updatedAt = Date.now()
  await table.put(next)
  const left = (await conflictLog()).filter(e => !(e.table === entry.table && e.id === entry.id && e.path === entry.path && e.at === entry.at))
  await setMeta('conflicts', left)
  return 'restored'
}

export { clearConflicts, conflictLog }
export type { ConflictEntry }
