import { describe, expect, it } from 'vitest'
import { decodeRow, encodeRow } from '@/vault/codec'

describe('the row codec', () => {
  it('round-trips plain rows, including nested values, unicode and empty containers', async () => {
    const row = { id: 'p1', firstName: 'Ольга', tags: ['a', 'б'], prefs: { food: 'суши', hobbies: [] }, n: 0, ok: false, nothing: null, photo: 'data:image/png;base64,AAAA' }
    expect(decodeRow(await encodeRow(row))).toEqual(row)
  })

  it('keeps dates, binary data and Blobs (recordings) intact, with their types', async () => {
    const row = { id: 'a', at: new Date(Date.UTC(2026, 10, 3)), bytes: new Uint8Array([1, 2, 3, 250]), audio: new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/webm' }), second: new Blob(['hello'], { type: 'text/plain' }) }
    const back = decodeRow(await encodeRow(row)) as typeof row
    expect(back.at).toEqual(row.at)
    expect([...back.bytes]).toEqual([1, 2, 3, 250])
    expect(back.audio.type).toBe('audio/webm')
    expect([...new Uint8Array(await back.audio.arrayBuffer())]).toEqual([9, 8, 7])
    expect(await back.second.text()).toBe('hello')
  })

  it('drops undefined fields, as JSON does, and nothing else', async () => {
    expect(decodeRow(await encodeRow({ a: 1, b: undefined, c: [undefined, 2].filter(x => x !== undefined) }))).toEqual({ a: 1, c: [2] })
  })

  it('a value that merely looks like a tag is not mistaken for one', async () => {
    const rows = [{ note: { $t: 'someone-wrote-this', v: 5 } }, { note: { $t: 'date', v: 5 } }, { $x: { $t: 'blob', i: 0, n: 3 } }]
    for (const row of rows) expect(decodeRow(await encodeRow(row))).toEqual(row)
  })
})
