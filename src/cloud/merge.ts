/**
 * Field-level three-way merge of one synced record.
 *
 * The old rule was "the newest whole record wins", so two devices that edited different fields of one person offline
 * lost one of the edits. Here every field is compared with `base`, the state both devices last agreed on (what the cloud
 * held when this device last synced the row):
 *
 *   changed on one side only          → that side's value
 *   changed to the same value         → that value
 *   changed on both sides, differently → merged by type, and only if it cannot be merged, the newer edit wins:
 *       • objects          field by field, recursively
 *       • arrays           as sets (what each side added or removed is kept; items with an `id` merge by id)
 *       • long text        word by word (diff3), so two edits in different sentences both survive
 *       • anything else    the newer edit; the older value is reported in `conflicts` so nothing is silently lost
 *
 * The function is pure and symmetric: swapping the two sides (and their times) gives the same record, which is what
 * makes devices converge no matter who merges first. Equal times are broken by comparing the values, not by "who is local".
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export interface FieldConflict {
  /** Dotted path of the field, e.g. `prefs.food`. */
  path: string
  /** The value that lost (kept in the log so it can be restored). */
  lost: unknown
  /** Which side's value was kept. */
  kept: 'local' | 'remote'
}

export interface MergeResult {
  value: Record<string, unknown>
  conflicts: FieldConflict[]
}

export interface MergeTimes {
  /** When the local edit was made (the outbox stamp). */
  localTs: number
  /** The `client_ts` of the version that came from the cloud. */
  remoteTs: number
}

/** Longest text (in tokens) merged word by word; beyond it the newer text wins, as the diff would be too slow. */
const MAX_DIFF_TOKENS = 4000

/** Keys in alphabetical order, so equal content has equal text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const same = (a: unknown, b: unknown): boolean => a === b || canonical(a) === canonical(b)
const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

interface Ctx extends MergeTimes {
  conflicts: FieldConflict[]
}

/** Whether the local value outranks the remote one: the newer edit, and at equal times the greater text (the same on every device). */
function localWins(local: unknown, remote: unknown, ctx: MergeTimes): boolean {
  return ctx.localTs !== ctx.remoteTs ? ctx.localTs > ctx.remoteTs : canonical(local) >= canonical(remote)
}

/** The newer value wins; at equal times the greater canonical text does, the same on every device. */
function newer(path: string, local: unknown, remote: unknown, ctx: Ctx): unknown {
  const keepLocal = localWins(local, remote, ctx)
  ctx.conflicts.push(keepLocal ? { path, lost: remote, kept: 'local' } : { path, lost: local, kept: 'remote' })
  return keepLocal ? local : remote
}

// ───────── text ─────────

const tokenize = (text: string): string[] => text.match(/\s+|\S+/g) ?? []

interface Hunk {
  /** Range of base tokens replaced (start inclusive, end exclusive); start === end is a pure insertion. */
  start: number
  end: number
  replacement: string[]
}

/** The edit script from `base` to `other`, as hunks, via the longest common subsequence of tokens. */
function hunksOf(base: string[], other: string[]): Hunk[] {
  const n = base.length
  const m = other.length
  // lcs[i][j]: length of the LCS of base[i..] and other[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = base[i] === other[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === other[j]) {
      i++
      j++
      continue
    }
    const start = i
    const from = j
    while ((i < n || j < m) && !(i < n && j < m && base[i] === other[j])) {
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) i++
      else j++
    }
    hunks.push({ start, end: i, replacement: other.slice(from, j) })
  }
  return hunks
}

/**
 * diff3 on words: edits of both sides that touch different parts of the text are both applied, and two insertions at
 * the same point (a line appended on both devices) are both kept, `localFirst` deciding which comes first. `null` when
 * two edits overlap and disagree.
 */
export function mergeText(base: string, local: string, remote: string, localFirst = true): string | null {
  const b = tokenize(base)
  const l = tokenize(local)
  const r = tokenize(remote)
  if (b.length > MAX_DIFF_TOKENS || l.length > MAX_DIFF_TOKENS || r.length > MAX_DIFF_TOKENS) return null

  const tagged = [
    ...hunksOf(b, l).map((hunk) => ({ hunk, side: 'l' as const })),
    ...hunksOf(b, r).map((hunk) => ({ hunk, side: 'r' as const })),
  ].sort((x, y) => x.hunk.start - y.hunk.start || x.hunk.end - y.hunk.end)

  const out: string[] = []
  let position = 0
  let index = 0
  while (index < tagged.length) {
    // Collect the group of hunks that overlap each other (two insertions at one point overlap too).
    const group = [tagged[index]]
    let end = tagged[index].hunk.end
    let start = tagged[index].hunk.start
    index++
    while (index < tagged.length) {
      const next = tagged[index].hunk
      const touches = next.start < end || (next.start === end && (next.start === next.end || start === end))
      if (!touches) break
      group.push(tagged[index])
      end = Math.max(end, next.end)
      start = Math.min(start, next.start)
      index++
    }
    out.push(...b.slice(position, start))
    const sides = new Set(group.map((entry) => entry.side))
    if (sides.size === 1) {
      // Hunks of one side never overlap each other: apply them in order.
      let cursor = start
      for (const { hunk } of group) {
        out.push(...b.slice(cursor, hunk.start), ...hunk.replacement)
        cursor = hunk.end
      }
      out.push(...b.slice(cursor, end))
    } else {
      const lefts = group.filter((entry) => entry.side === 'l')
      const rights = group.filter((entry) => entry.side === 'r')
      if (group.every((entry) => entry.hunk.start === entry.hunk.end)) {
        // Only insertions, all at one point: keep both, in the same order on every device.
        const [first, second] = localFirst ? [lefts, rights] : [rights, lefts]
        for (const { hunk } of [...first, ...second]) out.push(...hunk.replacement)
        position = end
        continue
      }
      const render = (list: typeof group): string[] => {
        const result: string[] = []
        let cursor = start
        for (const { hunk } of list) {
          result.push(...b.slice(cursor, hunk.start), ...hunk.replacement)
          cursor = hunk.end
        }
        result.push(...b.slice(cursor, end))
        return result
      }
      const left = render(lefts)
      const right = render(rights)
      if (left.join('') !== right.join('')) return null
      out.push(...left)
    }
    position = end
  }
  out.push(...b.slice(position))
  return out.join('')
}

// ───────── arrays ─────────

const isPrimitive = (value: unknown): boolean => value === null || typeof value !== 'object'

/** The identity of an array item: its `id` when every item has one, otherwise its content. */
function identity(list: Json[]): ((item: Json) => string) | null {
  if (list.every(isPrimitive)) return (item) => canonical(item)
  if (list.every((item) => isObject(item) && typeof item.id === 'string')) return (item) => `id:${(item as JsonObject).id as string}`
  if (list.every(isObject)) return (item) => canonical(item)
  return null
}

function mergeArray(path: string, base: Json[], local: Json[], remote: Json[], ctx: Ctx): Json[] {
  const key = identity([...base, ...local, ...remote])
  if (!key) return newer(path, local, remote, ctx) as Json[]
  const byKey = (list: Json[]) => new Map(list.map((item) => [key(item), item]))
  const b = byKey(base)
  const l = byKey(local)
  const r = byKey(remote)

  // Order: the newer side's order first, then what only the other side added. The same on every device.
  const localFirst = localWins(local, remote, ctx)
  const ids = [...new Set(localFirst ? [...l.keys(), ...r.keys()] : [...r.keys(), ...l.keys()])]

  const out: Json[] = []
  for (const id of ids) {
    const inL = l.has(id)
    const inR = r.has(id)
    const was = b.get(id)
    if (inL && inR) out.push(mergeItem(`${path}[${id}]`, was, l.get(id) as Json, r.get(id) as Json, ctx))
    else if (inL) {
      // Gone remotely: stays gone, unless it was edited here in the meantime.
      if (!b.has(id) || !same(l.get(id), was)) out.push(l.get(id) as Json)
    } else if (!b.has(id) || !same(r.get(id), was)) out.push(r.get(id) as Json)
  }
  return out
}

/** An item present on both sides: objects with an id merge field by field, the rest by the usual rules. */
function mergeItem(path: string, base: Json | undefined, local: Json, remote: Json, ctx: Ctx): Json {
  if (same(local, remote)) return local
  if (isObject(local) && isObject(remote)) return mergeObject(path, isObject(base) ? base : {}, local, remote, ctx)
  return mergeValue(path, base, local, remote, ctx) as Json
}

// ───────── objects and values ─────────

function mergeObject(path: string, base: JsonObject, local: JsonObject, remote: JsonObject, ctx: Ctx): JsonObject {
  const out: JsonObject = {}
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])
  for (const key of [...keys].sort()) {
    const at = path ? `${path}.${key}` : key
    const value = mergeValue(at, base[key], local[key], remote[key], ctx, key)
    if (value !== undefined) out[key] = value as Json
  }
  return out
}

function mergeValue(path: string, base: unknown, local: unknown, remote: unknown, ctx: Ctx, key?: string): unknown {
  if (same(local, remote)) return local
  if (same(base, local)) return remote
  if (same(base, remote)) return local

  // Both sides changed it, differently.
  if (key === 'updatedAt' && typeof local === 'number' && typeof remote === 'number') return Math.max(local, remote)
  if (isObject(local) && isObject(remote)) return mergeObject(path, isObject(base) ? base : {}, local, remote, ctx)
  if (Array.isArray(local) && Array.isArray(remote)) return mergeArray(path, Array.isArray(base) ? base : [], local, remote, ctx)
  // Word-level merge needs a common text to compare with; two unrelated texts are a conflict, not an append.
  if (typeof local === 'string' && typeof remote === 'string' && typeof base === 'string' && base !== '') {
    const merged = mergeText(base, local, remote, localWins(local, remote, ctx))
    if (merged !== null) return merged
  }
  return newer(path, local, remote, ctx)
}

/**
 * Merges the two versions of a record that were edited from the same `base`.
 * `base` is `undefined` for a record created on this device before the cloud ever saw it: there is nothing to compare
 * with, so the caller should use "the newer wins" for the whole record instead.
 */
export function mergeRecords(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>, times: MergeTimes): MergeResult {
  const ctx: Ctx = { ...times, conflicts: [] }
  const value = mergeObject('', base as JsonObject, local as JsonObject, remote as JsonObject, ctx)
  return { value, conflicts: ctx.conflicts }
}
