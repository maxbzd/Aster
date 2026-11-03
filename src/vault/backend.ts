/**
 * Which IndexedDB the app's Dexie talks to. The app builds its database once, at import, with these two objects as its
 * "indexedDB" and "IDBKeyRange"; they forward to whichever backend is active when the database is opened:
 *   native  the browser's IndexedDB (the default, and the whole app before encryption is turned on)
 *   memory  an in-memory IndexedDB (fake-indexeddb): while the vault is unlocked every row lives here, and only sealed
 *           copies reach the disk (see session.ts)
 */

type Kind = 'native' | 'memory' | 'pending';
let kind: Kind = 'native';
let memory: { factory: IDBFactory; range: typeof IDBKeyRange } | null = null;
let release: (() => void) | null = null;
let settled: Promise<void> = Promise.resolve();

/**
 * Call once, before the database object is made. If the hint says encryption is on, the backend starts "pending":
 * anything that tries to open the database (some modules read a setting as soon as they are imported) waits until
 * the vault has unlocked and chosen the in-memory backend, instead of opening, or creating, a plain database.
 */
export function initBackend(hintKey: string): void {
  try {
    if (globalThis.localStorage?.getItem(hintKey) === '1') {
      kind = 'pending';
      settled = new Promise<void>(resolve => { release = resolve; });
    }
  } catch {
    // storage blocked: the gate still looks for the journal itself
  }
}

export const backendKind = (): Kind => kind;

const nativeFactory = (): IDBFactory => globalThis.indexedDB;
const factoryNow = (): IDBFactory => (kind === 'memory' && memory ? memory.factory : nativeFactory());
const rangeNow = (): typeof IDBKeyRange => (kind === 'memory' && memory ? memory.range : globalThis.IDBKeyRange);

function settle(): void {
  release?.();
  release = null;
}

export function selectNativeBackend(): void {
  kind = 'native';
  memory = null;
  settle();
}

/** Switches to a fresh, empty in-memory database. The real one is untouched. */
export async function selectMemoryBackend(): Promise<void> {
  const fake = await import('fake-indexeddb');
  memory = { factory: new fake.IDBFactory() as unknown as IDBFactory, range: fake.IDBKeyRange as unknown as typeof IDBKeyRange };
  kind = 'memory';
  settle();
}

/**
 * An open request that is not made yet. Dexie sets its handlers right after `open()` returns; they are passed on to the
 * real request once the backend is chosen.
 */
function deferredOpen(name: string, version?: number): IDBOpenDBRequest {
  let real: IDBOpenDBRequest | null = null;
  const handlers = new Map<PropertyKey, unknown>();
  const proxy = new Proxy({} as IDBOpenDBRequest, {
    get(_t, prop) {
      if (real) {
        const value = (real as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof value === 'function' ? value.bind(real) : value;
      }
      return handlers.get(prop);
    },
    set(_t, prop, value) {
      handlers.set(prop, value);
      if (real) (real as unknown as Record<PropertyKey, unknown>)[prop] = value;
      return true;
    },
  });
  void settled.then(() => {
    real = factoryNow().open(name, version);
    for (const [prop, value] of handlers) (real as unknown as Record<PropertyKey, unknown>)[prop] = value;
  });
  return proxy;
}

/** The browser's own IndexedDB, whatever is active (for the journal and for deleting the old database). */
export const realIndexedDB = (): IDBFactory => nativeFactory();

export const backendFactory = {
  open: (name: string, version?: number) => (kind === 'pending' ? deferredOpen(name, version) : factoryNow().open(name, version)),
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
