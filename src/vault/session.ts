import type { Dexie, Table } from 'dexie';
import { CryptoError } from '@/crypto/password';
import { ARGON2_DEFAULT, type Argon2Params } from '@/crypto/password';
import { selectMemoryBackend, selectNativeBackend, realIndexedDB } from './backend';
import {
  createVault as makeVault, openWithPasskeySecret, openWithPassword, openWithRecoveryKey, rowKey,
  withNewPassword, withNewRecoveryKey, withPasskey, withoutPasskey, type VaultHeader,
} from './keys';
import { deleteJournal, hasJournal, openJournal, openRow, sealRow, slot, type JournalStore } from './store';

/**
 * The runtime of the vault: encryption at rest for one Dexie database.
 *
 * Off (the default): the app talks to the browser's IndexedDB as it always did.
 * On: nothing readable is ever written to disk. The database lives in memory (the backend, see backend.ts) while the
 * vault is unlocked; every change is sealed with the data key (AES-256-GCM, bound to the row's place) and written to an
 * encrypted journal within a fraction of a second, and again when the page goes to the background. Locking (by hand,
 * after a time of inactivity, or when the app is left in the background) reloads the page, which drops every plain
 * value from memory.
 *
 * What stays visible to someone who copies the disk: that the vault exists, the names of the tables, how many rows each
 * has, and the size of each sealed row. Not what is in them.
 */

export { useVaultState } from './state';
import { useVaultState, type VaultState } from './state';
export type { VaultState };

export interface VaultConfig {
  /** names the AAD and the storage keys: "aster", "orbita" */
  app: string;
  db: Dexie;
  /** the encrypted journal's database name */
  journalName: string;
  /** reloads the page (replaced in tests) */
  reload?: () => void;
}

export type UnlockSecret =
  | { kind: 'password'; password: string }
  | { kind: 'recovery'; key: string }
  | { kind: 'passkey'; credentialId: string; secret: Uint8Array };

/** `tab`: the vault is already open in another window of the app (two memory copies would drift apart). */
export type UnlockResult = 'ok' | 'wrong' | 'wait' | 'error' | 'tab';

const FLUSH_DELAY_MS = 30;
const LOAD_BATCH = 200;
const encodeKey = (k: unknown) => JSON.stringify(k);

/** Seconds to wait after the n-th wrong attempt in a row: free for two, then 2, 4, 8 … up to 60. */
export const throttleSeconds = (failures: number): number => (failures <= 2 ? 0 : Math.min(60, 2 ** (failures - 2)));

export interface PreparedVault {
  recoveryKey: string;
  /** Deletes the plain database and reloads: from now on the app opens locked. Call after the person saved the recovery key. */
  commit(): Promise<void>;
  /** Gives up: the encrypted copy is removed, nothing else changed. */
  abort(): Promise<void>;
}

export function createVaultRuntime(cfg: VaultConfig) {
  const { app, db, journalName } = cfg;
  const reload = cfg.reload ?? (() => location.reload());
  const FLAG = `${app}.vault`;
  const THROTTLE = `${app}.vault.throttle`;
  const AUTOLOCK = `${app}.vault.autolock`;

  let journal: JournalStore | null = null;
  let header: VaultHeader | null = null;
  let dek: Uint8Array<ArrayBuffer> | null = null;
  let key: CryptoKey | null = null;
  const dirty = new Map<string, { table: string; pk: unknown }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let hooked = false;

  const set = (state: VaultState) => useVaultState.setState({ state });
  const busy = (busyNow: boolean) => useVaultState.setState({ busy: busyNow });
  const tables = (): Table[] => db.tables as Table[];

  // ───────── boot ─────────

  /** Looks for the encrypted journal. Call once, before anything touches the database. */
  async function boot(): Promise<VaultState> {
    const found = await hasJournal(realIndexedDB(), journalName).catch(() => null);
    if (!found) {
      selectNativeBackend();
      set('off');
      return 'off';
    }
    header = found;
    try { localStorage.setItem(FLAG, '1'); } catch { /* the journal itself is the truth */ }
    set('locked');
    return 'locked';
  }

  // ───────── throttling ─────────

  const loadFailures = (): { failures: number; until: number } => {
    try {
      const raw = JSON.parse(localStorage.getItem(THROTTLE) ?? 'null') as { failures?: number; until?: number } | null;
      return { failures: raw?.failures ?? 0, until: raw?.until ?? 0 };
    } catch { return { failures: 0, until: 0 }; }
  };
  const saveFailures = (failures: number, until: number) => {
    try { if (failures === 0) localStorage.removeItem(THROTTLE); else localStorage.setItem(THROTTLE, JSON.stringify({ failures, until })); } catch { /* in-memory only */ }
  };
  const secondsUntilRetry = (now = Date.now()): number => Math.max(0, Math.ceil((loadFailures().until - now) / 1000));

  // ───────── one window at a time ─────────

  /** The decrypted copy lives in this window's memory: a second window would have its own, and the two would overwrite each other. */
  function takeTabLock(): Promise<boolean> {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) return Promise.resolve(true);
    return new Promise(resolve => {
      void locks.request(`${app}-vault-open`, { ifAvailable: true }, lock => {
        resolve(!!lock);
        return lock ? new Promise<void>(() => undefined) : undefined; // held until the window closes
      });
    });
  }

  /** "I lost every way in": removes the encrypted data for good, so the app can start empty. */
  async function eraseEverything(): Promise<void> {
    journal?.close();
    journal = null;
    await deleteJournal(realIndexedDB(), journalName).catch(() => undefined);
    try { localStorage.removeItem(FLAG); localStorage.removeItem(THROTTLE); } catch { /* nothing to remove */ }
    dek = null;
    key = null;
    header = null;
    reload();
  }

  // ───────── unlock ─────────

  async function openDek(h: VaultHeader, secret: UnlockSecret): Promise<Uint8Array<ArrayBuffer>> {
    if (secret.kind === 'password') return openWithPassword(h, secret.password);
    if (secret.kind === 'recovery') return openWithRecoveryKey(h, secret.key);
    return openWithPasskeySecret(h, secret.credentialId, secret.secret);
  }

  async function unlock(secret: UnlockSecret, now = Date.now()): Promise<UnlockResult> {
    if (!header) return 'error';
    const { failures, until } = loadFailures();
    if (now < until) return 'wait';
    let opened: Uint8Array<ArrayBuffer>;
    try {
      opened = await openDek(header, secret);
    } catch (e) {
      if (e instanceof CryptoError && e.code === 'wrong_password') {
        saveFailures(failures + 1, now + throttleSeconds(failures + 1) * 1000);
        return 'wrong';
      }
      return 'error';
    }
    if (!(await takeTabLock())) { opened.fill(0); return 'tab'; }
    busy(true);
    try {
      await activate(opened);
      saveFailures(0, 0);
      return 'ok';
    } catch {
      return 'error';
    } finally {
      busy(false);
    }
  }

  /** Opens the in-memory database, decrypts the journal into it and starts keeping the journal up to date. */
  async function activate(opened: Uint8Array<ArrayBuffer>): Promise<void> {
    dek = opened;
    key = await rowKey(opened);
    journal = await openJournal(realIndexedDB(), journalName);
    // a database that something opened early (before the vault was open) must not stay in use
    if (db.isOpen()) db.close();
    await selectMemoryBackend();
    await db.open();
    const byTable = new Map<string, { keys: unknown[]; rows: unknown[] }>();
    const sealed: Array<[string, Uint8Array]> = [];
    await journal.eachRow((k, bytes) => { sealed.push([k, bytes]); });
    for (let i = 0; i < sealed.length; i += LOAD_BATCH) {
      const part = await Promise.all(sealed.slice(i, i + LOAD_BATCH).map(async ([slotName, bytes]) => ({ slotName, ...(await openRow(key as CryptoKey, slotName, bytes)) })));
      for (const { slotName, k, r } of part) {
        const table = slotName.slice(0, slotName.indexOf('\u0001'));
        const entry = byTable.get(table) ?? { keys: [], rows: [] };
        entry.keys.push(k);
        entry.rows.push(r);
        byTable.set(table, entry);
      }
    }
    for (const [name, { keys, rows }] of byTable) {
      const t = tables().find(x => x.name === name);
      if (t) await (t.schema.primKey.keyPath ? t.bulkPut(rows) : t.bulkPut(rows, keys as never));
    }
    track();
    startWatching();
    set('unlocked');
  }

  // ───────── keeping the journal up to date ─────────

  function track() {
    if (hooked) return;
    hooked = true;
    for (const t of tables()) {
      t.hook('creating', (pk, obj) => { mark(t, pk ?? (t.schema.primKey.keyPath ? readPath(obj, t.schema.primKey.keyPath) : undefined)); });
      t.hook('updating', (_mods, pk) => { mark(t, pk); });
      t.hook('deleting', pk => { mark(t, pk); });
    }
  }
  const readPath = (obj: unknown, path: string | string[]): unknown => (Array.isArray(path) ? path.map(p => (obj as Record<string, unknown>)[p]) : path.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], obj));

  function mark(t: Table, pk: unknown) {
    if (pk === undefined) return;
    dirty.set(slot(t.name, pk), { table: t.name, pk });
    if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_DELAY_MS);
  }

  /** Seals what changed and writes it. Safe to call at any time; calls queue up. */
  function flush(): Promise<void> {
    chain = chain.then(async () => {
      if (!journal || !key || dirty.size === 0) return;
      const batch = [...dirty.entries()];
      dirty.clear();
      try {
        const puts: Array<[string, Uint8Array]> = [];
        const dels: string[] = [];
        const byTable = new Map<string, Array<[string, unknown]>>();
        for (const [slotName, { table, pk }] of batch) byTable.set(table, [...(byTable.get(table) ?? []), [slotName, pk]]);
        for (const [name, list] of byTable) {
          const t = tables().find(x => x.name === name);
          if (!t) continue;
          const rows = await t.bulkGet(list.map(([, pk]) => pk) as never);
          for (const [i, [slotName, pk]] of list.entries()) {
            const row = rows[i];
            if (row === undefined) dels.push(slotName);
            else puts.push([slotName, await sealRow(key, slotName, pk, row)]);
          }
        }
        await journal.putRows(puts);
        await journal.deleteRows(dels);
      } catch (e) {
        for (const [k, v] of batch) if (!dirty.has(k)) dirty.set(k, v); // try again with the next change or on leaving
        throw e;
      }
    }).catch(() => undefined);
    return chain;
  }

  // ───────── locking ─────────

  let watching = false;
  function startWatching() {
    if (watching) return;
    watching = true;
    let hiddenAt = 0;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const minutes = () => autoLockMinutes();
    const arm = () => { if (idle) clearTimeout(idle); if (minutes() > 0) idle = setTimeout(() => void lock(), minutes() * 60_000); };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); void flush(); }
      else if (hiddenAt && minutes() > 0 && Date.now() - hiddenAt >= minutes() * 60_000) void lock();
      else arm();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', () => void flush());
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, arm, { passive: true });
    arm();
  }

  function autoLockMinutes(): number { try { return Number(localStorage.getItem(AUTOLOCK) ?? 5); } catch { return 5; } }
  function setAutoLockMinutes(minutes: number) { try { localStorage.setItem(AUTOLOCK, String(minutes)); } catch { /* default applies */ } }

  /** Writes what is pending, forgets the key and reloads: the page comes back asking for the password. */
  async function lock(): Promise<void> {
    await flush();
    dek?.fill(0);
    dek = null;
    key = null;
    reload();
  }

  // ───────── turning it on and off ─────────

  async function readAll(): Promise<Array<{ table: string; pk: unknown; row: unknown }>> {
    const all: Array<{ table: string; pk: unknown; row: unknown }> = [];
    for (const t of tables()) await t.each((row, cursor) => { all.push({ table: t.name, pk: cursor.primaryKey, row }); });
    return all;
  }

  /**
   * Makes an encrypted copy of everything in the (plain) database and the header that opens it, and returns the
   * recovery key. The plain database is deleted only by `commit()`, after the person has saved the key.
   */
  async function prepare(password: string, argon2: Argon2Params = ARGON2_DEFAULT): Promise<PreparedVault> {
    if (useVaultState.getState().state !== 'off') throw new Error('The vault is already on.');
    busy(true);
    const created = await makeVault(app, password, argon2);
    const j = await openJournal(realIndexedDB(), journalName);
    try {
      await j.clearRows();
      const k = await rowKey(created.dek);
      const all = await readAll();
      for (let i = 0; i < all.length; i += LOAD_BATCH) {
        const part = all.slice(i, i + LOAD_BATCH);
        await j.putRows(await Promise.all(part.map(async ({ table, pk, row }) => { const s = slot(table, pk); return [s, await sealRow(k, s, pk, row)] as [string, Uint8Array]; })));
      }
      // proof that it can be read back, before the plain copy is allowed to go
      if ((await j.count()) !== all.length) throw new Error('The encrypted copy is incomplete.');
      const sample = all[Math.floor(all.length / 2)];
      if (sample) {
        let found: Uint8Array | undefined;
        await j.eachRow((s, b) => { if (s === slot(sample.table, sample.pk)) found = b; });
        const back = await openRow(k, slot(sample.table, sample.pk), found!);
        if (encodeKey(back.k) !== encodeKey(sample.pk)) throw new Error('The encrypted copy does not read back.');
      }
      await j.putHeader(created.header); // last: its presence is what makes the vault "on"
    } catch (e) {
      await j.clearRows().catch(() => undefined);
      j.close();
      await deleteJournal(realIndexedDB(), journalName).catch(() => undefined);
      busy(false);
      throw e;
    }
    j.close();
    busy(false);
    created.dek.fill(0);
    return {
      recoveryKey: created.recoveryKey,
      async commit() {
        busy(true);
        db.close();
        await new Promise<void>((resolve, reject) => {
          const req = realIndexedDB().deleteDatabase(db.name);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('Close the other windows of the app and try again.'));
        });
        try { localStorage.setItem(FLAG, '1'); } catch { /* the journal is the truth */ }
        reload();
      },
      async abort() {
        await deleteJournal(realIndexedDB(), journalName).catch(() => undefined);
      },
    };
  }

  /** Back to the plain database. Needs the vault unlocked: it is the memory that holds the data. */
  async function disable(): Promise<void> {
    if (useVaultState.getState().state !== 'unlocked') throw new Error('Unlock first.');
    busy(true);
    await flush();
    const all = await readAll();
    db.close();
    selectNativeBackend();
    await db.open();
    const byTable = new Map<string, { keys: unknown[]; rows: unknown[] }>();
    for (const { table, pk, row } of all) { const e = byTable.get(table) ?? { keys: [], rows: [] }; e.keys.push(pk); e.rows.push(row); byTable.set(table, e); }
    for (const [name, { keys, rows }] of byTable) { const t = tables().find(x => x.name === name); if (t) await (t.schema.primKey.keyPath ? t.bulkPut(rows) : t.bulkPut(rows, keys as never)); }
    journal?.close();
    journal = null;
    await deleteJournal(realIndexedDB(), journalName);
    try { localStorage.removeItem(FLAG); } catch { /* nothing to remove */ }
    dek?.fill(0);
    dek = null;
    key = null;
    reload();
  }

  // ───────── keys ─────────

  async function saveHeader(next: VaultHeader) {
    await journal!.putHeader(next);
    header = next;
  }

  const requireOpen = () => { if (!dek || !header || !journal) throw new Error('Unlock first.'); return { dek, header, journal }; };

  async function changePassword(password: string, argon2: Argon2Params = ARGON2_DEFAULT): Promise<void> {
    const s = requireOpen();
    await saveHeader(await withNewPassword(s.header, s.dek, password, argon2));
  }

  /** A new recovery key replaces the old one. Returns the new key to show. */
  async function renewRecoveryKey(): Promise<string> {
    const s = requireOpen();
    const next = await withNewRecoveryKey(s.header, s.dek);
    await saveHeader(next.header);
    return next.recoveryKey;
  }

  async function addPasskey(credentialId: string, prfSalt: Uint8Array, secret: Uint8Array, label: string): Promise<void> {
    const s = requireOpen();
    await saveHeader(await withPasskey(s.header, s.dek, credentialId, prfSalt, secret, label));
  }

  async function removePasskey(credentialId: string): Promise<void> {
    const s = requireOpen();
    await saveHeader(withoutPasskey(s.header, credentialId));
  }

  /** Checks a password without opening anything (to confirm a risky action). */
  async function verifyPassword(password: string): Promise<boolean> {
    const h = header;
    if (!h) return false;
    try { (await openWithPassword(h, password)).fill(0); return true; } catch { return false; }
  }

  return {
    boot, unlock, lock, prepare, disable, flush, secondsUntilRetry, verifyPassword, eraseEverything,
    changePassword, renewRecoveryKey, addPasskey, removePasskey,
    autoLockMinutes, setAutoLockMinutes,
    header: () => header,
    state: () => useVaultState.getState().state,
  };
}

export type VaultRuntime = ReturnType<typeof createVaultRuntime>;
