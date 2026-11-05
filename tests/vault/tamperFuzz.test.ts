import { describe, expect, it } from 'vitest'
import { rowKey } from '@/vault/keys'
import { openRow, sealRow, slot } from '@/vault/store'

const key = await rowKey(new Uint8Array(32).map((_, i) => i + 1))
const place = slot('people', 'p1')

describe('a sealed record on disk cannot be changed without notice', () => {
  it('opens untouched', async () => {
    const sealed = await sealRow(key, place, 'p1', { id: 'p1', firstName: 'Ольга', notes: 'любит чай' })
    expect(await openRow(key, place, sealed)).toEqual({ k: 'p1', r: { id: 'p1', firstName: 'Ольга', notes: 'любит чай' } })
  })

  it('every byte of it is checked: changing any one bit of any position is refused', async () => {
    const sealed = await sealRow(key, place, 'p1', { id: 'p1', firstName: 'Ольга', notes: 'любит чай' })
    let accepted = 0
    for (let i = 0; i < sealed.length; i++) {
      for (const bit of [0, 3, 7]) {
        const copy = sealed.slice()
        copy[i] = copy[i]! ^ (1 << bit)
        try { await openRow(key, place, copy); accepted++ } catch { /* refused, as it should be */ }
      }
    }
    expect(accepted).toBe(0)
  })

  it('a shortened or lengthened record is refused, at every length', async () => {
    const sealed = await sealRow(key, place, 'p1', { id: 'p1', firstName: 'Ольга' })
    let accepted = 0
    for (let n = 0; n < sealed.length; n++) { try { await openRow(key, place, sealed.slice(0, n)); accepted++ } catch { /* refused */ } }
    for (const extra of [1, 2, 16]) { try { await openRow(key, place, new Uint8Array([...sealed, ...new Uint8Array(extra)])); accepted++ } catch { /* refused */ } }
    expect(accepted).toBe(0)
  })

  it('it opens only in its own place and only with its own key', async () => {
    const sealed = await sealRow(key, place, 'p1', { id: 'p1' })
    await expect(openRow(key, slot('people', 'p2'), sealed)).rejects.toBeDefined()
    await expect(openRow(key, slot('interactions', 'p1'), sealed)).rejects.toBeDefined()
    await expect(openRow(await rowKey(new Uint8Array(32).fill(9)), place, sealed)).rejects.toBeDefined()
  })

  it('two seals of the same record are different (a fresh random IV each time)', async () => {
    const a = await sealRow(key, place, 'p1', { id: 'p1' })
    const b = await sealRow(key, place, 'p1', { id: 'p1' })
    expect(a).not.toEqual(b)
  })
})
