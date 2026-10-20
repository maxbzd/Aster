import { describe, expect, it } from 'vitest'
import { analyzeGraph, betweenness, buildEdges, detectClusters, layoutGraph } from '@/data/graph'
import { weakTies } from '@/data/weak'
import { DAY } from '@/lib/format'
import { interaction, NOW, person } from '../helpers'

const link = (to: string) => ({ personId: to, label: 'знакомы' })

/** Две компании по 3 человека и один «мост» между ними. */
const world = () => [
  person({ id: 'a1', firstName: 'Анна', links: [link('a2'), link('a3')], company: 'Акме' }),
  person({ id: 'a2', firstName: 'Антон', links: [link('a3')], company: 'Акме' }),
  person({ id: 'a3', firstName: 'Алиса', links: [], company: 'Акме' }),
  person({ id: 'b1', firstName: 'Борис', links: [link('b2'), link('b3')], company: 'Бета' }),
  person({ id: 'b2', firstName: 'Богдан', links: [link('b3')], company: 'Бета' }),
  person({ id: 'b3', firstName: 'Белла', links: [], company: 'Бета' }),
  person({ id: 'm', firstName: 'Мария', links: [link('a1'), link('b1')], company: 'Фонд' }),
  person({ id: 'solo', firstName: 'Сергей', links: [] }),
]

describe('граф связей', () => {
  it('собирает рёбра из связей, «кто познакомил», знакомств и общих встреч; дубли не плодит', () => {
    const ps = [
      person({ id: 'a', links: [link('b')] }),
      person({ id: 'b', links: [link('a')], introducedBy: 'c' }),
      person({ id: 'c' }),
      person({ id: 'd' }),
    ]
    const intro = { id: 'i', aId: 'c', bId: 'd', reason: '', status: 'done' as const, createdAt: 1, updatedAt: 1 }
    const e = buildEdges(ps, [intro], [interaction({ personIds: ['a', 'd'], type: 'event' })])
    const keys = e.map(x => `${x.a}${x.b}`).sort()
    expect(keys).toEqual(['ab', 'ad', 'bc', 'cd'])
    expect(e.find(x => x.a === 'a' && x.b === 'b')?.kinds).toEqual(['link'])
  })

  it('общие встречи считаются только для небольших компаний: на большом событии знакомы не все', () => {
    const ps = Array.from({ length: 9 }, (_, i) => person({ id: `p${i}` }))
    const e = buildEdges(ps, [], [interaction({ personIds: ps.map(p => p.id), type: 'event' })])
    expect(e).toHaveLength(0)
  })

  it('делит на группы по связям', () => {
    const g = analyzeGraph(world())
    const cluster = (id: string) => g.clusterOf.get(id)
    expect(cluster('a1')).toBe(cluster('a2'))
    expect(cluster('a2')).toBe(cluster('a3'))
    expect(cluster('b1')).toBe(cluster('b2'))
    expect(cluster('a1')).not.toBe(cluster('b1'))
    expect(g.isolated.map(p => p.id)).toEqual(['solo'])
  })

  it('мост — тот, кто соединяет группы, и он на первом месте', () => {
    const g = analyzeGraph(world())
    expect(g.bridges[0]?.person.id).toBe('m')
    expect(g.bridges[0]?.clusters.length).toBeGreaterThanOrEqual(2)
    expect(g.bridges.map(b => b.person.id)).not.toContain('a3')
  })

  it('посредничество: у центра цепочки оно максимальное, у краёв — нулевое', () => {
    const ps = ['x', 'y', 'z'].map(id => person({ id }))
    const b = betweenness(['x', 'y', 'z'], [{ a: 'x', b: 'y', w: 1, kinds: ['link'] }, { a: 'y', b: 'z', w: 1, kinds: ['link'] }])
    expect(b.get('y')).toBe(1)
    expect(b.get('x')).toBe(0)
    expect(ps).toHaveLength(3)
  })

  it('группы называются по общему кругу, а при его отсутствии — по компании', () => {
    const ps = world().map(p => (p.id.startsWith('a') ? { ...p, circleIds: ['c1'] } : p))
    const g = analyzeGraph(ps, [], [], id => (id === 'c1' ? 'Друзья' : undefined))
    const names = g.clusters.map(c => c.name)
    expect(names).toContain('Друзья')
    expect(names).toContain('Бета')
  })

  it('номера групп идут от самой большой; результат одинаковый при любом порядке людей', () => {
    const w = world()
    const a = detectClusters(w.map(p => p.id), buildEdges(w))
    const shuffled = [...w].reverse()
    const b = detectClusters(shuffled.map(p => p.id), buildEdges(shuffled))
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
  })

  it('раскладка укладывает всех в рамку и детерминирована', () => {
    const w = world()
    const g = analyzeGraph(w)
    const ids = g.connected.map(p => p.id)
    const l1 = layoutGraph(ids, g.edges, g.clusterOf, 360, 420)
    const l2 = layoutGraph(ids, g.edges, g.clusterOf, 360, 420)
    expect([...l1.entries()]).toEqual([...l2.entries()])
    for (const { x, y } of l1.values()) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(360)
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(420)
    }
    // члены одной группы ближе друг к другу, чем к чужой
    const d = (a: string, b: string) => Math.hypot(l1.get(a)!.x - l1.get(b)!.x, l1.get(a)!.y - l1.get(b)!.y)
    expect(d('a2', 'a3')).toBeLessThan(d('a2', 'b2'))
  })

  it('пустой и одиночный граф не ломаются', () => {
    expect(layoutGraph([], [], new Map(), 300, 300).size).toBe(0)
    expect(layoutGraph(['x'], [], new Map(), 300, 300).get('x')).toEqual({ x: 150, y: 150 })
    expect(analyzeGraph([]).clusters).toEqual([])
  })

  it('семья и архив в графе не участвуют', () => {
    const g = analyzeGraph([person({ id: 'a', links: [link('f')] }), person({ id: 'f', familyOf: 'a' }), person({ id: 'z', archived: true, links: [link('a')] })])
    expect(g.edges).toHaveLength(0)
  })
})

describe('слабые связи', () => {
  const at = (d: number) => NOW - d * DAY
  it('в списке дальние знакомые с потенциалом; близкие и люди со статусом не попадают', () => {
    const ps = [
      ...world().map(p => ({ ...p, closeness: 3 as const, lastContactAt: at(200) })),
      person({ id: 'near', closeness: 1, links: [link('a3')] }),
      person({ id: 'quiet', closeness: 3, lifeStatus: 'paused', links: [link('b3')] }),
    ]
    const g = analyzeGraph(ps)
    const list = weakTies(ps, [], g, NOW)
    expect(list.map(x => x.person.id)).toContain('m')
    expect(list.map(x => x.person.id)).not.toContain('near')
    expect(list.map(x => x.person.id)).not.toContain('quiet')
    expect(list.find(x => x.person.id === 'm')?.reasons.join(' ')).toMatch(/Мост между мирами|разных групп/)
    expect(list[0]?.score).toBeGreaterThanOrEqual(list.at(-1)!.score)
  })

  it('учитывает редкий город, влиятельную роль и давнее молчание — и объясняет это словами', () => {
    const ps = [
      person({ id: 'a', closeness: 4, city: 'Дубай', role: 'Managing Partner', canHelpMe: 'интро к фондам', lastContactAt: at(300) }),
      person({ id: 'b', closeness: 4, city: 'Москва' }),
      person({ id: 'c', closeness: 4, city: 'Москва' }),
      person({ id: 'd', closeness: 4, city: 'Москва' }),
    ]
    const [top] = weakTies(ps, [], analyzeGraph(ps), NOW)
    expect(top?.person.id).toBe('a')
    const text = top!.reasons.join(' | ')
    expect(text).toMatch(/Дубай/)
    expect(text).toMatch(/помочь|Роль/)
    expect(top!.score).toBeGreaterThan(40)
  })

  it('«почти близкий» без контактов за год тоже считается слабой связью, а с регулярным общением — нет', () => {
    const base = person({ id: 'x', closeness: 2, city: 'Тбилиси', role: 'CEO', canHelpMe: 'интро', lastContactAt: at(250) })
    const regular = person({ id: 'y', closeness: 2, city: 'Тбилиси', role: 'CEO', canHelpMe: 'интро', lastContactAt: at(5) })
    const ints = [at(5), at(40), at(80), at(120)].map(d => interaction({ personIds: ['y'], date: d }))
    const ids = weakTies([base, regular], ints, analyzeGraph([base, regular], [], ints), NOW).map(x => x.person.id)
    expect(ids).toContain('x')
    expect(ids).not.toContain('y')
  })
})
