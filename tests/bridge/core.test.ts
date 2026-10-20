import { beforeEach, describe, expect, it } from 'vitest'
import { acceptPairingCode, createPairingCode, disconnectPeer } from '@/bridge/connect'
import { bridgeCycle, buildLinkMap, type BridgeAdapter } from '@/bridge/cycle'
import { decodePairing, encodePairing, hashToken, newToken } from '@/bridge/pairing'
import { BridgeError, type FeedItem, type PulledItem } from '@/bridge/protocol'
import { allScopes, MemoryMeta, Project, worldFetch } from './world'

const A = { label: 'Aster', url: 'https://aster.test', key: 'sb_publishable_aster' }
const B = { label: 'Орбита', url: 'https://orbita.test', key: 'sb_publishable_orbita' }

let a: Project, b: Project, f: typeof fetch
beforeEach(() => {
  a = new Project(A.url, A.key)
  b = new Project(B.url, B.key)
  f = worldFetch([a, b])
})

describe('код подключения', () => {
  it('кодируется и разбирается обратно, терпит пробелы и кавычки', () => {
    const p = { u: 'https://x.supabase.co', k: 'sb_publishable_abc', c: `bo_${'a'.repeat(48)}`, l: 'Орбита' }
    const text = encodePairing(p)
    expect(text.startsWith('bridge1.')).toBe(true)
    expect(decodePairing(`  «${text.slice(0, 20)}\n${text.slice(20)}»  `)).toEqual(p)
  })
  it.each([['', 'не код'], ['hello', 'не код'], ['bridge1.@@@', 'повреждён'], ['bridge1.e30', 'повреждён']])('%j отвергается', (text, why) => {
    expect(() => decodePairing(text)).toThrow(why === 'не код' ? /Это не код/ : /повреждён/)
  })
  it('адрес не https или без кода — отвергается', () => {
    const bad = (u: string, c: string) => encodePairing({ u, k: 'k', c, l: '' })
    expect(() => decodePairing(bad('http://x.co', `bo_${'a'.repeat(48)}`))).toThrow(BridgeError)
    expect(() => decodePairing(bad('https://x.co', 'bo_short'))).toThrow(BridgeError)
  })
  it('ключи доступа: длинные, случайные, хэш стабилен', async () => {
    const t1 = newToken()
    expect(t1).toMatch(/^bt_[0-9a-f]{64}$/)
    expect(newToken()).not.toBe(t1)
    expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('подключение', () => {
  it('код → ключи в обе стороны', async () => {
    const { text } = await createPairingCode(a.own(), A)
    const id = await acceptPairingCode(b.own(), B, text, allScopes, f)
    const ca = (await a.own().listConnections())[0]!
    const cb = (await b.own().listConnections()).find(c => c.id === id)!
    expect(ca).toMatchObject({ peer_label: 'Орбита', peer_url: B.url, peer_key: B.key })
    expect(cb).toMatchObject({ peer_label: 'Aster', peer_url: A.url, peer_key: A.key })
    // каждая сторона держит ключ, который проверяет другая
    expect(await hashToken(ca.outbound_token!)).toBe(b.conns[0]!.inbound_hash)
    expect(await hashToken(cb.outbound_token!)).toBe(a.conns[0]!.inbound_hash)
  })

  it('код одноразовый', async () => {
    const { text } = await createPairingCode(a.own(), A)
    await acceptPairingCode(b.own(), B, text, allScopes, f)
    const other = new Project('https://third.test', 'k')
    await expect(acceptPairingCode(other.own(), { ...B, url: other.url }, text, allScopes, worldFetch([a, other]))).rejects.toMatchObject({ kind: 'code-expired' })
    expect(other.conns).toHaveLength(0) // после неудачи ничего не осталось
  })

  it('просроченный код не принимается, у принимающего ничего не остаётся', async () => {
    const { text } = await createPairingCode(a.own(), A)
    a.now = () => Date.now() + 11 * 60_000
    await expect(acceptPairingCode(b.own(), B, text, allScopes, f)).rejects.toMatchObject({ kind: 'code-expired' })
    expect(b.conns).toHaveLength(0)
  })

  it('нет сети при обмене кода — понятная ошибка и чистое состояние', async () => {
    const { text } = await createPairingCode(a.own(), A)
    a.failNext = 1
    await expect(acceptPairingCode(b.own(), B, text, allScopes, f)).rejects.toMatchObject({ kind: 'offline' })
    expect(b.conns).toHaveLength(0)
    // код не сгорел, можно повторить
    await acceptPairingCode(b.own(), B, text, allScopes, f)
    expect(b.conns).toHaveLength(1)
  })

  it('свой же код вставить нельзя', async () => {
    const { text } = await createPairingCode(a.own(), A)
    await expect(acceptPairingCode(a.own(), A, text, allScopes, f)).rejects.toMatchObject({ kind: 'bad-code' })
  })

  it('отключение убирает ключи с обеих сторон', async () => {
    const { text } = await createPairingCode(a.own(), A)
    await acceptPairingCode(b.own(), B, text, allScopes, f)
    const cb = (await b.own().listConnections())[0]!
    await disconnectPeer(b.own(), cb, f)
    expect(b.conns).toHaveLength(0)
    expect(a.conns).toHaveLength(0)
  })
})

/** Простой адаптер: публикует заданные записи и запоминает полученные. */
function simpleAdapter(items: () => FeedItem[]): BridgeAdapter & { got: PulledItem[] } {
  const got: PulledItem[] = []
  return { got, collect: async () => items(), apply: async rows => { got.push(...rows); return { links: [], changed: rows.length } } }
}

async function paired() {
  const { text } = await createPairingCode(a.own(), A)
  await acceptPairingCode(b.own(), B, text, allScopes, f)
}

describe('цикл обмена', () => {
  it('без подключений ничего не делает', async () => {
    const ad = simpleAdapter(() => [])
    const r = await bridgeCycle({ own: a.own(), adapter: ad, meta: new MemoryMeta(), fetchImpl: f })
    expect(r).toMatchObject({ published: 0, pulled: 0, peers: [] })
  })

  it('публикует своё, забирает чужое, не публикует то, что не менялось', async () => {
    await paired()
    let mine: FeedItem[] = [{ entity: 'person', key: 'a1', data: { name: 'Алина' }, deleted: false }]
    const adA = simpleAdapter(() => mine)
    const adB = simpleAdapter(() => [{ entity: 'commitment', key: 'c1', data: { title: 'Презентация' }, deleted: false }])
    const metaA = new MemoryMeta()
    const metaB = new MemoryMeta()
    expect((await bridgeCycle({ own: a.own(), adapter: adA, meta: metaA, fetchImpl: f })).published).toBe(1)
    expect((await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })).pulled).toBe(1)
    expect(adB.got.map(r => r.key)).toEqual(['a1'])
    await bridgeCycle({ own: a.own(), adapter: adA, meta: metaA, fetchImpl: f })
    expect(adA.got.map(r => r.key)).toEqual(['c1'])

    // повторный круг без изменений: ничего не публикуется
    expect((await bridgeCycle({ own: a.own(), adapter: adA, meta: metaA, fetchImpl: f })).published).toBe(0)
    // изменилось — уходит одно
    mine = [{ entity: 'person', key: 'a1', data: { name: 'Алина В.' }, deleted: false }]
    expect((await bridgeCycle({ own: a.own(), adapter: adA, meta: metaA, fetchImpl: f })).published).toBe(1)
    await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })
    expect(adB.got.at(-1)).toMatchObject({ key: 'a1', data: { name: 'Алина В.' } })
  })

  it('исчезнувшее у источника доходит как удалённое', async () => {
    await paired()
    let mine: FeedItem[] = [{ entity: 'fact', key: 'f1', data: { title: 'Любит бег' }, deleted: false }]
    const adA = simpleAdapter(() => mine)
    const adB = simpleAdapter(() => [])
    const metaA = new MemoryMeta()
    const metaB = new MemoryMeta()
    await bridgeCycle({ own: a.own(), adapter: adA, meta: metaA, fetchImpl: f })
    mine = []
    await bridgeCycle({ own: a.own(), adapter: adA, meta: metaA, fetchImpl: f })
    await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })
    expect(adB.got.at(-1)).toMatchObject({ key: 'f1', deleted: true })
  })

  it('читает только разрешённое владельцем', async () => {
    await paired()
    const adA = simpleAdapter(() => [
      { entity: 'person', key: 'p', data: { name: 'x' }, deleted: false },
      { entity: 'capture', key: 'c', data: { day: '2026-10-01' }, deleted: false },
    ])
    await bridgeCycle({ own: a.own(), adapter: adA, meta: new MemoryMeta(), fetchImpl: f })
    // Aster разрешает другой стороне только людей
    await a.own().setScopes(a.conns[0]!.id, ['people'])
    const adB = simpleAdapter(() => [])
    await bridgeCycle({ own: b.own(), adapter: adB, meta: new MemoryMeta(), fetchImpl: f })
    expect(adB.got.map(r => r.entity)).toEqual(['person'])
  })

  it('нет сети: статус offline, состояние не портится, потом всё догоняется', async () => {
    await paired()
    const ad = simpleAdapter(() => [{ entity: 'person', key: 'p', data: { name: 'x' }, deleted: false }])
    const metaB = new MemoryMeta()
    const adB = simpleAdapter(() => [])
    await bridgeCycle({ own: a.own(), adapter: ad, meta: new MemoryMeta(), fetchImpl: f })
    a.failNext = 1
    const r1 = await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })
    expect(r1.peers[0]!.status).toBe('offline')
    const r2 = await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })
    expect(r2.peers[0]!.status).toBe('ok')
    expect(adB.got).toHaveLength(1)
  })

  it('другая сторона отключилась: статус revoked, а не падение', async () => {
    await paired()
    await a.own().disconnect(a.conns[0]!.id)
    const r = await bridgeCycle({ own: b.own(), adapter: simpleAdapter(() => []), meta: new MemoryMeta(), fetchImpl: f })
    expect(r.peers[0]).toMatchObject({ status: 'revoked' })
  })

  it('ошибка применения не сдвигает курсор: следующий круг повторит', async () => {
    await paired()
    const adA = simpleAdapter(() => [{ entity: 'person', key: 'p', data: { name: 'x' }, deleted: false }])
    await bridgeCycle({ own: a.own(), adapter: adA, meta: new MemoryMeta(), fetchImpl: f })
    let fail = true
    const seen: string[] = []
    const adB: BridgeAdapter = { collect: async () => [], apply: async rows => { if (fail) throw new Error('boom'); seen.push(...rows.map(r => r.key)); return { links: [], changed: 0 } } }
    const metaB = new MemoryMeta()
    expect((await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })).peers[0]!.status).toBe('error')
    fail = false
    await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })
    expect(seen).toEqual(['p'])
  })

  it('связи из адаптера записываются, и следующий круг читает чужие данные заново', async () => {
    await paired()
    const adA = simpleAdapter(() => [{ entity: 'person', key: 'p1', data: { name: 'Алина' }, deleted: false }])
    await bridgeCycle({ own: a.own(), adapter: adA, meta: new MemoryMeta(), fetchImpl: f })
    const seen: number[] = []
    let first = true
    const adB: BridgeAdapter = {
      collect: async () => [],
      apply: async rows => {
        seen.push(rows.length)
        if (first) { first = false; return { links: [{ local_id: 'x', peer_id: 'p1', origin: 'auto', deleted: false, updated_ms: 5 }], changed: 1 } }
        return { links: [], changed: 0 }
      },
    }
    const metaB = new MemoryMeta()
    const r = await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })
    expect(r.linksChanged).toBe(1)
    expect([...b.links.values()]).toHaveLength(1)
    expect(await metaB.get(`cursor:${b.conns[0]!.id}`)).toBe(0)
    await bridgeCycle({ own: b.own(), adapter: adB, meta: metaB, fetchImpl: f })
    expect(seen).toEqual([1, 1]) // тот же ряд перечитан после появления связи
  })
})

describe('buildLinkMap', () => {
  it('активные связи в обе стороны, разорванные — отдельно', () => {
    const m = buildLinkMap([
      { local_id: 'a', peer_id: 'x', origin: 'user', deleted: false, updated_ms: 1 },
      { local_id: 'b', peer_id: 'y', origin: 'auto', deleted: true, updated_ms: 1 },
    ])
    expect(m.byLocal.get('a')).toBe('x')
    expect(m.byPeer.get('x')).toBe('a')
    expect(m.byLocal.has('b')).toBe(false)
    expect(m.blocked).toEqual([{ localId: 'b', peerId: 'y' }])
  })
})
