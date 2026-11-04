import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { folderAccess, folderBackupSupported, forgetFolder, pickFolder, writeToFolder } from '../../src/lib/folder'

// a real directory handle cannot be copied into a test database (it holds functions), so the store keeps the object itself
const kept = new Map<unknown, unknown>()
type Perm = 'granted' | 'prompt' | 'denied'

function fakeDir(files: string[], perm: Perm = 'granted') {
  const written: Record<string, string> = {}
  const removed: string[] = []
  const handle = {
    name: 'Backups',
    queryPermission: vi.fn(async () => perm),
    requestPermission: vi.fn(async () => 'granted' as Perm),
    getFileHandle: vi.fn(async (name: string) => ({
      createWritable: async () => ({ write: async (d: string) => { written[name] = d }, close: async () => undefined }),
    })),
    removeEntry: vi.fn(async (name: string) => { removed.push(name) }),
    entries: () => (async function* () {
      for (const f of [...files, ...Object.keys(written)]) yield [f, { kind: 'file' }] as [string, { kind: string }]
      yield ['sub', { kind: 'directory' }] as [string, { kind: string }]
    })(),
  }
  return { handle, written, removed }
}

beforeEach(() => {
  kept.clear()
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(((value: unknown, key?: IDBValidKey) => {
    kept.set(key, value)
    return fakeRequest(undefined)
  }) as never)
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation((() => fakeRequest(kept.get('backup'))) as never)
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation((() => {
    kept.clear()
    return fakeRequest(undefined)
  }) as never)
})
afterEach(() => { delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker })

function fakeRequest<T>(result: T): IDBRequest<T> {
  const req = { result, error: null, onsuccess: null as null | (() => void), onerror: null } as unknown as IDBRequest<T>
  queueMicrotask(() => (req as { onsuccess: null | (() => void) }).onsuccess?.())
  return req
}

describe('the backup folder', () => {
  it('is supported only where the browser has a folder picker', () => {
    expect(folderBackupSupported()).toBe(false)
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => undefined
    expect(folderBackupSupported()).toBe(true)
  })

  it('no folder chosen: no access, and nothing can be written', async () => {
    expect(await folderAccess()).toBe('none')
    await expect(writeToFolder('a.json', '{}', 'aster-', 3)).rejects.toThrow('no folder')
  })

  it('picking a folder keeps it; a cancelled picker is not an error', async () => {
    const { handle } = fakeDir([])
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = vi.fn(async () => handle)
    expect(await pickFolder()).toEqual({ name: 'Backups' })
    expect(await folderAccess()).toBe('granted')

    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) })
    expect(await pickFolder()).toBeNull()

    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = vi.fn(async () => { throw new Error('boom') })
    await expect(pickFolder()).rejects.toThrow('boom')
  })

  it('asks the browser for permission again only when told to', async () => {
    const { handle } = fakeDir([], 'prompt')
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => handle
    await pickFolder()
    expect(await folderAccess()).toBe('prompt')
    expect(handle.requestPermission).not.toHaveBeenCalled()
    expect(await folderAccess(true)).toBe('granted')
    expect(handle.requestPermission).toHaveBeenCalledOnce()
  })

  it('writes the file and deletes the oldest ones beyond the number to keep (other files and folders are left alone)', async () => {
    const { handle, written, removed } = fakeDir(['aster-1.json', 'aster-2.json', 'aster-3.json', 'notes.txt'])
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => handle
    await pickFolder()
    await writeToFolder('aster-4.json', '{"ok":1}', 'aster-', 2)
    expect(written['aster-4.json']).toBe('{"ok":1}')
    expect(removed).toEqual(['aster-1.json', 'aster-2.json'])
  })

  it('a file that cannot be deleted does not fail the backup', async () => {
    const { handle } = fakeDir(['aster-1.json', 'aster-2.json'])
    handle.removeEntry.mockRejectedValue(new Error('locked'))
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => handle
    await pickFolder()
    await expect(writeToFolder('aster-3.json', '{}', 'aster-', 1)).resolves.toBeUndefined()
  })

  it('forgetting the folder leaves none', async () => {
    const { handle } = fakeDir([])
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => handle
    await pickFolder()
    await forgetFolder()
    expect(await folderAccess()).toBe('none')
  })
})
