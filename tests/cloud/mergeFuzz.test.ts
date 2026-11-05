import { describe, expect, it } from 'vitest'
import { canonical, mergeRecords } from '@/cloud/merge'

/** Random records, made from a fixed seed so a failure can be replayed. */
function rng(seed: number) {
  let s = seed
  const next = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
  const int = (n: number) => Math.floor(next() * n)
  const pick = <T,>(a: readonly T[]): T => a[int(a.length)]!
  return { next, int, pick }
}
type R = ReturnType<typeof rng>
const WORDS = ['кофе', 'джаз', 'Берлин', 'bike', 'wine', 'встреча', 'идея', 'позвонить', 'в', 'пятницу']
const text = (r: R) => Array.from({ length: 1 + r.int(8) }, () => r.pick(WORDS)).join(' ')
const scalar = (r: R): unknown => r.pick([() => text(r), () => r.int(5), () => r.next() < 0.5, () => null, () => ''])()
function value(r: R, depth = 0): unknown {
  const k = r.int(depth > 1 ? 3 : 5)
  if (k === 0) return text(r)
  if (k === 1) return r.int(10)
  if (k === 2) return Array.from({ length: r.int(4) }, () => scalar(r)).filter(x => x !== null)
  if (k === 3) return Object.fromEntries(Array.from({ length: 1 + r.int(3) }, () => [r.pick(['a', 'b', 'c', 'd']), value(r, depth + 1)]))
  return r.next() < 0.5
}
const record = (r: R) => Object.fromEntries(Array.from({ length: 2 + r.int(5) }, (_, i) => [r.pick(['name', 'notes', 'tags', 'prefs', 'city', 'n', 'flag', 'updatedAt']) + (i > 4 ? i : ''), value(r)]))
/** An edit of a record: a few fields changed, added or removed. */
function edit(r: R, base: Record<string, unknown>) {
  const out = structuredClone(base)
  for (let i = 0, n = 1 + r.int(3); i < n; i++) {
    const keys = Object.keys(out)
    const key = keys.length && r.next() < 0.7 ? r.pick(keys) : r.pick(['name', 'notes', 'tags', 'prefs', 'city', 'extra'])
    const roll = r.next()
    if (roll < 0.2) delete out[key]
    else if (typeof out[key] === 'string' && roll < 0.6) out[key] = `${out[key]} ${r.pick(WORDS)}`
    else if (Array.isArray(out[key]) && roll < 0.6) out[key] = [...(out[key] as unknown[]), scalar(r)]
    else out[key] = value(r)
  }
  return out
}

describe('merging two edits of one record (random cases)', () => {
  const cases = Array.from({ length: 2500 }, (_, i) => i)
  const make = (i: number) => {
    const r = rng(i + 1)
    const base = record(r)
    const a = edit(r, base)
    const b = edit(r, base)
    const ta = 1000 + r.int(3) * 10 // times collide often on purpose
    const tb = 1000 + r.int(3) * 10
    return { base, a, b, ta, tb }
  }

  it('is symmetric: it does not matter which device merges (the devices converge)', () => {
    const bad: number[] = []
    for (const i of cases) {
      const { base, a, b, ta, tb } = make(i)
      const x = mergeRecords(base, a, b, { localTs: ta, remoteTs: tb })
      const y = mergeRecords(base, b, a, { localTs: tb, remoteTs: ta })
      if (canonical(x.value) !== canonical(y.value)) bad.push(i)
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('merging an edit with itself changes nothing, and merging with an unedited side gives the edit', () => {
    const bad: string[] = []
    for (const i of cases) {
      const { base, a, b, ta, tb } = make(i)
      if (canonical(mergeRecords(base, a, a, { localTs: ta, remoteTs: tb }).value) !== canonical(a)) bad.push(`same ${i}`)
      if (canonical(mergeRecords(base, a, base, { localTs: ta, remoteTs: tb }).value) !== canonical(a)) bad.push(`local-only ${i}`)
      if (canonical(mergeRecords(base, base, b, { localTs: ta, remoteTs: tb }).value) !== canonical(b)) bad.push(`remote-only ${i}`)
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('the result is plain data that survives a round trip through JSON, and a conflict always names a real field', () => {
    const bad: string[] = []
    for (const i of cases) {
      const { base, a, b, ta, tb } = make(i)
      const { value: merged } = mergeRecords(base, a, b, { localTs: ta, remoteTs: tb })
      if (canonical(JSON.parse(JSON.stringify(merged))) !== canonical(merged)) bad.push(`json ${i}`)
      // the sync engine takes the merged version as the new base, so what must hold is that meeting it again changes nothing
      if (canonical(mergeRecords(merged, merged, merged, { localTs: ta, remoteTs: tb }).value) !== canonical(merged)) bad.push(`stable ${i}`)
      for (const c of mergeRecords(base, a, b, { localTs: ta, remoteTs: tb }).conflicts) {
        if (!c.path || !['local', 'remote'].includes(c.kept)) bad.push(`conflict ${i}`)
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })
})
