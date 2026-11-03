/**
 * A folder the person chose for automatic backups (the File System Access API: Chrome, Edge and Android Chrome; not
 * Safari or Firefox, where backups stay a manual file). The browser keeps the permission; the handle is kept in its own
 * small IndexedDB so it does not travel with the data.
 */

type Permission = 'granted' | 'prompt' | 'denied'
interface DirHandle {
  name: string
  queryPermission(opts: { mode: 'readwrite' }): Promise<Permission>
  requestPermission(opts: { mode: 'readwrite' }): Promise<Permission>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }>
  removeEntry(name: string): Promise<void>
  entries(): AsyncIterable<[string, { kind: string }]>
}

const DB = 'aster-fs'
const STORE = 'handles'
const KEY = 'backup'

export const folderBackupSupported = (): boolean => typeof window !== 'undefined' && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = f(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** Opens the system folder picker (must be called from a tap). `null` when the person cancels. */
export async function pickFolder(): Promise<{ name: string } | null> {
  try {
    const handle = (await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ id: 'aster-backup', mode: 'readwrite', startIn: 'documents' }))
    await run('readwrite', s => s.put(handle, KEY))
    return { name: handle.name }
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return null
    throw e
  }
}

async function saved(): Promise<DirHandle | null> {
  try {
    return ((await run('readonly', s => s.get(KEY))) as DirHandle | undefined) ?? null
  } catch {
    return null
  }
}

export async function folderAccess(request = false): Promise<'none' | Permission> {
  const h = await saved()
  if (!h) return 'none'
  const mode = { mode: 'readwrite' } as const
  const now = await h.queryPermission(mode)
  return now === 'prompt' && request ? h.requestPermission(mode) : now
}

/** Writes a text file into the folder, and deletes the oldest files that start with `prefix`, keeping `keep`. */
export async function writeToFolder(filename: string, text: string, prefix: string, keep: number): Promise<void> {
  const h = await saved()
  if (!h) throw new Error('no folder')
  const file = await (await h.getFileHandle(filename, { create: true })).createWritable()
  await file.write(text)
  await file.close()
  const names: string[] = []
  for await (const [name, entry] of h.entries()) if (entry.kind === 'file' && name.startsWith(prefix)) names.push(name)
  names.sort()
  for (const old of names.slice(0, Math.max(0, names.length - keep))) await h.removeEntry(old).catch(() => undefined)
}

export async function forgetFolder(): Promise<void> {
  await run('readwrite', s => s.delete(KEY)).catch(() => undefined)
}
