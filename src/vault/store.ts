import { concat, utf8 } from '@/crypto/bytes';
import { CryptoError } from '@/crypto/password';
import { decodeRow, encodeRow } from './codec';
import type { VaultHeader } from './keys';

/**
 * The encrypted journal on disk: its own small IndexedDB, with a header (the wrapped keys) and one sealed record per
 * database row. Nothing in it is readable; the key of a record is the table name and the row's key.
 */

export const META = 'meta';
export const ROWS = 'rows';

export interface JournalStore {
  header(): Promise<VaultHeader | null>;
  putHeader(header: VaultHeader): Promise<void>;
  putRows(entries: Array<[string, Uint8Array]>): Promise<void>;
  deleteRows(keys: string[]): Promise<void>;
  eachRow(cb: (key: string, sealed: Uint8Array) => void): Promise<void>;
  count(): Promise<number>;
  clearRows(): Promise<void>;
  close(): void;
}

const wrap = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export function openJournal(factory: IDBFactory, name: string): Promise<JournalStore> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(META); req.result.createObjectStore(ROWS); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
    req.onsuccess = () => {
      const idb = req.result;
      resolve({
        async header() { return ((await wrap(idb.transaction(META, 'readonly').objectStore(META).get('header'))) as VaultHeader | undefined) ?? null; },
        async putHeader(header) { const tx = idb.transaction(META, 'readwrite'); tx.objectStore(META).put(header, 'header'); await done(tx); },
        async putRows(entries) {
          if (!entries.length) return;
          const tx = idb.transaction(ROWS, 'readwrite');
          for (const [key, value] of entries) tx.objectStore(ROWS).put(value, key);
          await done(tx);
        },
        async deleteRows(keys) {
          if (!keys.length) return;
          const tx = idb.transaction(ROWS, 'readwrite');
          for (const key of keys) tx.objectStore(ROWS).delete(key);
          await done(tx);
        },
        eachRow(cb) {
          return new Promise((res, rej) => {
            const c = idb.transaction(ROWS, 'readonly').objectStore(ROWS).openCursor();
            c.onerror = () => rej(c.error);
            c.onsuccess = () => { const cur = c.result; if (cur) { cb(String(cur.key), cur.value as Uint8Array); cur.continue(); } else res(); };
          });
        },
        count: () => wrap(idb.transaction(ROWS, 'readonly').objectStore(ROWS).count()),
        async clearRows() { const tx = idb.transaction(ROWS, 'readwrite'); tx.objectStore(ROWS).clear(); await done(tx); },
        close: () => idb.close(),
      });
    };
  });
}

export function deleteJournal(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = factory.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

/** Whether a journal with a header exists, without creating one. */
export async function hasJournal(factory: IDBFactory, name: string): Promise<VaultHeader | null> {
  const names = (factory as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases;
  if (names) {
    try {
      if (!(await names.call(factory)).some(d => d.name === name)) return null;
    } catch {
      // fall through: open it
    }
  }
  const journal = await openJournal(factory, name);
  try {
    return await journal.header();
  } finally {
    journal.close();
  }
}

// ───────── One sealed record ─────────

/** `table` + the row's key: also what the record is bound to, so a record cannot be moved to another place. */
export const slot = (table: string, key: unknown): string => `${table}\u0001${JSON.stringify(key)}`;

export async function sealRow(key: CryptoKey, slotName: string, primaryKey: unknown, row: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const payload = await encodeRow({ k: primaryKey, r: row });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(slotName) }, key, payload));
  return concat(iv, sealed);
}

export async function openRow(key: CryptoKey, slotName: string, bytes: Uint8Array): Promise<{ k: unknown; r: unknown }> {
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(slotName) }, key, bytes.slice(12)));
    return decodeRow(plain) as { k: unknown; r: unknown };
  } catch {
    throw new CryptoError('invalid_payload', 'A stored record could not be opened.');
  }
}
