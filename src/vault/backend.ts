/**
 * Which IndexedDB the app's Dexie talks to. The app builds its database once, at import, with these two objects as its
 * "indexedDB" and "IDBKeyRange"; they forward to whichever backend is active when the database is opened:
 *   native  the browser's IndexedDB (the default, and the whole app before encryption is turned on)
 *   memory  an in-memory IndexedDB (fake-indexeddb): while the vault is unlocked every row lives here, and only sealed
 *           copies reach the disk (see session.ts)
 */

type Kind = 'native' | 'memory';
let kind: Kind = 'native';
let memory: { factory: IDBFactory; range: typeof IDBKeyRange } | null = null;

export const backendKind = (): Kind => kind;

const nativeFactory = (): IDBFactory => globalThis.indexedDB;
const factoryNow = (): IDBFactory => (kind === 'memory' && memory ? memory.factory : nativeFactory());
const rangeNow = (): typeof IDBKeyRange => (kind === 'memory' && memory ? memory.range : globalThis.IDBKeyRange);

export function selectNativeBackend(): void {
  kind = 'native';
  memory = null;
}

/** Switches to a fresh, empty in-memory database. The real one is untouched. */
export async function selectMemoryBackend(): Promise<void> {
  const fake = await import('fake-indexeddb');
  memory = { factory: new fake.IDBFactory() as unknown as IDBFactory, range: fake.IDBKeyRange as unknown as typeof IDBKeyRange };
  kind = 'memory';
}

/** The browser's own IndexedDB, whatever is active (for the journal and for deleting the old database). */
export const realIndexedDB = (): IDBFactory => nativeFactory();

export const backendFactory = {
  open: (name: string, version?: number) => factoryNow().open(name, version),
  deleteDatabase: (name: string) => factoryNow().deleteDatabase(name),
  cmp: (a: unknown, b: unknown) => factoryNow().cmp(a, b),
  databases: () => (factoryNow() as IDBFactory & { databases(): Promise<IDBDatabaseInfo[]> }).databases(),
} as unknown as IDBFactory;

export const backendKeyRange = {
  bound: (...a: Parameters<typeof IDBKeyRange.bound>) => rangeNow().bound(...a),
  lowerBound: (...a: Parameters<typeof IDBKeyRange.lowerBound>) => rangeNow().lowerBound(...a),
  upperBound: (...a: Parameters<typeof IDBKeyRange.upperBound>) => rangeNow().upperBound(...a),
  only: (...a: Parameters<typeof IDBKeyRange.only>) => rangeNow().only(...a),
} as unknown as typeof IDBKeyRange;

/**
 * Whether an encrypted journal exists, answered without loading anything heavy: this runs on every start.
 * `null` when the browser cannot list databases (the caller then relies on its own hint).
 */
export async function journalExists(name: string): Promise<boolean | null> {
  const factory = nativeFactory() as IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> };
  if (typeof factory.databases !== 'function') return null;
  try {
    return (await factory.databases()).some(d => d.name === name);
  } catch {
    return null;
  }
}
