import { describe, expect, it } from 'vitest'
import { cadenceSuggestions, nearestCadence, reciprocity, reciprocityRanking, scoreFromRatio, suggestCadence, warmthHistory, warmthTrend, yearSummaries } from '@/data/history'
import { cadenceOf } from '@/data/logic'
import { DAY } from '@/lib/format'
import type { Initiator, Interaction, InteractionType } from '@/data/types'
import { interaction, NOW, person } from '../helpers'

const at = (daysAgo: number) => NOW - daysAgo * DAY
const ints = (id: string, daysAgo: number[], type: InteractionType = 'meeting', initiator?: Initiator): Interaction[] =>
  daysAgo.map(d => interaction({ personIds: [id], type, date: at(d), initiator }))

describe('warmthHistory', () => {
  it('month by month: warm after a meeting, then cooling, warm again after a new meeting', () => {
    const p = person({ id: 'a', createdAt: at(400), closeness: 2, cadenceDays: 30, metAt: undefined })
    const list = ints('a', [330, 100, 20])
    const pts = warmthHistory(p, list, NOW)
    const byMonth = (daysAgo: number) => pts.find(x => x.t <= at(daysAgo) && at(daysAgo) < new Date(new Date(x.t).getFullYear(), new Date(x.t).getMonth() + 1, 1).getTime())!
    expect(byMonth(330).score).toBeGreaterThan(40)
    // cools between meetings: 3 months without contact at a 30-day rhythm is cold
    const quiet = pts.filter(x => x.t > at(300) && x.t < at(120))
    expect(Math.min(...quiet.map(x => x.score ?? 100))).toBeLessThan(25)
    expect(byMonth(20).score).toBeGreaterThan(40)
    expect(pts.at(-1)?.score).toBeGreaterThan(40)
  })

  it('counts the month\'s contacts and the weight of contact; a note is not a contact', () => {
    const p = person({ id: 'a', createdAt: at(120), cadenceDays: 30 })
    const pts = warmthHistory(p, [...ints('a', [3, 4], 'call'), ...ints('a', [5], 'meeting'), ...ints('a', [6], 'note')], NOW)
    const last = pts.at(-1)!
    const prev = pts.at(-2)!
    expect(last.count + prev.count).toBe(3)
    expect(last.activity + prev.activity).toBeCloseTo(2 + 2 + 3, 5)
  })

  it('before you met there is no score', () => {
    const p = person({ id: 'a', createdAt: at(10), metAt: undefined })
    const pts = warmthHistory(p, [], NOW)
    expect(pts.every(x => x.score !== null)).toBe(true)
    expect(pts.length).toBeLessThanOrEqual(2)
  })

  it('limits the length of the history', () => {
    const p = person({ id: 'a', createdAt: at(3000) })
    expect(warmthHistory(p, [], NOW, 24).length).toBeLessThanOrEqual(24)
  })

  it('a summary by year and the trend', () => {
    const p = person({ id: 'a', createdAt: at(800), cadenceDays: 30 })
    const pts = warmthHistory(p, [...ints('a', [790, 770, 740, 700]), ...ints('a', [30, 20, 10, 3])], NOW)
    const years = yearSummaries(pts)
    expect(years.length).toBeGreaterThanOrEqual(2)
    expect(years.reduce((s, y) => s + y.contacts, 0)).toBe(8)
    for (const y of years) if (y.best && y.worst) expect(y.best.score!).toBeGreaterThanOrEqual(y.worst.score!)
    expect(warmthTrend(pts)).toBe('up')
    const cooling = warmthHistory(p, ints('a', [790, 770, 740, 700, 300]), NOW)
    expect(warmthTrend(cooling)).not.toBe('up')
  })

  it('scoreFromRatio matches the warmth formula', () => {
    expect(scoreFromRatio(0)).toBe(100)
    expect(scoreFromRatio(0.5)).toBe(100)
    expect(scoreFromRatio(1)).toBe(75)
    expect(scoreFromRatio(3)).toBe(0)
  })
})

describe('reciprocity', () => {
  it('counts initiative and names the imbalance', () => {
    const mine = reciprocity([...ints('a', [3, 10, 20, 30, 40], 'message', 'me'), ...ints('a', [5], 'message', 'them')], NOW)
    expect(mine).toMatchObject({ me: 5, them: 1, level: 'me' })
    expect(mine.label).toBe('Чаще начинаешь ты — 83%')
    const theirs = reciprocity([...ints('a', [3, 10, 20, 30], 'call', 'them'), ...ints('a', [5], 'call', 'me')], NOW)
    expect(theirs.level).toBe('them')
    expect(theirs.label).toBe('Чаще начинают они — 80%')
    const even = reciprocity([...ints('a', [3, 10], 'call', 'them'), ...ints('a', [5, 12], 'call', 'me')], NOW)
    expect(even).toMatchObject({ level: 'balanced', label: 'Инициатива поровну' })
  })
  it('too few marks: no conclusions; shared meetings do not count', () => {
    expect(reciprocity(ints('a', [3, 4], 'message', 'me'), NOW).level).toBe('unknown')
    expect(reciprocity(ints('a', [3, 4, 5, 6, 7], 'meeting', 'both'), NOW)).toMatchObject({ both: 5, level: 'unknown' })
    expect(reciprocity([...ints('a', [3, 4, 5], 'message'), ...ints('a', [6], 'note', 'me')], NOW).unknown).toBe(3)
  })
  it('older than a year and a half is not counted', () => {
    expect(reciprocity(ints('a', [600, 700, 800, 900], 'message', 'me'), NOW)).toMatchObject({ me: 0, unknown: 0 })
  })
  it('imbalance ranking: the stronger on top, family and "not relevant" do not take part', () => {
    const a = person({ id: 'a', firstName: 'А' })
    const b = person({ id: 'b', firstName: 'Б' })
    const fam = person({ id: 'f', firstName: 'Ф', familyOf: 'a' })
    const gone = person({ id: 'g', firstName: 'Г', lifeStatus: 'irrelevant' })
    const all = [...ints('a', [1, 2, 3, 4, 5], 'message', 'me'), ...ints('b', [1, 2, 3, 4, 5, 6], 'message', 'them'), ...ints('b', [7], 'message', 'me'), ...ints('f', [1, 2, 3, 4], 'message', 'me'), ...ints('g', [1, 2, 3, 4], 'message', 'me')]
    expect(reciprocityRanking([a, b, fam, gone], all, NOW).map(x => x.p.id)).toEqual(['a', 'b'])
  })
})

describe('smart rhythms', () => {
  const weekly = (n: number) => Array.from({ length: n }, (_, i) => 5 + i * 7)
  it('in touch weekly while the rhythm is monthly → suggest more often', () => {
    const p = person({ id: 'a', closeness: 2, cadenceDays: 30 })
    const s = suggestCadence(p, ints('a', weekly(10), 'message'), NOW)
    expect(s).toMatchObject({ current: 30, actualDays: 7, suggested: 7, direction: 'shorter' })
    expect(s?.message).toMatch(/раз в 7 дн\./)
  })
  it('a weekly rhythm while in touch monthly → suggest less often', () => {
    const p = person({ id: 'a', closeness: 1, cadenceDays: 7 })
    const s = suggestCadence(p, ints('a', [5, 35, 65, 95, 125], 'call'), NOW)
    expect(s).toMatchObject({ suggested: 30, direction: 'longer' })
  })
  it('close to the rhythm: stay silent', () => {
    const p = person({ id: 'a', closeness: 2, cadenceDays: 30 })
    expect(suggestCadence(p, ints('a', [5, 33, 60, 92, 120], 'meeting'), NOW)).toBeNull()
  })
  it('too little data, notes, several records on one day do not count', () => {
    const p = person({ id: 'a', closeness: 2, cadenceDays: 90 })
    expect(suggestCadence(p, ints('a', [5, 12, 19], 'message'), NOW)).toBeNull()
    expect(suggestCadence(p, ints('a', weekly(10), 'note'), NOW)).toBeNull()
    const sameDay = [...ints('a', [5, 5, 5, 5, 5, 5], 'message'), ...ints('a', [40], 'message')]
    expect(suggestCadence(p, sameDay, NOW)).toBeNull()
  })
  it('family, "around every day", statuses and "no rhythm" are skipped', () => {
    const list = ints('a', weekly(10), 'message')
    for (const extra of [{ familyOf: 'x' }, { everyday: true }, { lifeStatus: 'paused' as const }, { cadenceDays: 0 }, { archived: true }]) {
      expect(suggestCadence(person({ id: 'a', closeness: 2, cadenceDays: 90, ...extra }), list, NOW)).toBeNull()
    }
  })
  it('the list for the screen: the biggest discrepancies first', () => {
    const a = person({ id: 'a', closeness: 2, cadenceDays: 30 })
    const b = person({ id: 'b', closeness: 2, cadenceDays: 180 })
    const res = cadenceSuggestions([a, b], [...ints('a', weekly(8), 'message'), ...ints('b', weekly(8), 'message')], NOW)
    expect(res.map(x => x.p.id)).toEqual(['b', 'a'])
  })
  it('nearestCadence by logarithm', () => {
    expect(nearestCadence(5)).toBe(7)
    expect(nearestCadence(20)).toBe(14)
    expect(nearestCadence(25)).toBe(30)
    expect(nearestCadence(60)).toBe(90)
    expect(nearestCadence(1000)).toBe(365)
  })
})

describe('cadenceOf: when no reminders are needed', () => {
  it('family, around every day and statuses give a zero rhythm', () => {
    expect(cadenceOf(person({ closeness: 1 }))).toBe(14)
    expect(cadenceOf(person({ closeness: 1, everyday: true }))).toBe(0)
    expect(cadenceOf(person({ closeness: 1, familyOf: 'x' }))).toBe(0)
    expect(cadenceOf(person({ closeness: 1, lifeStatus: 'lost_touch' }))).toBe(0)
    expect(cadenceOf(person({ closeness: 1, cadenceDays: 60 }))).toBe(60)
  })
})
