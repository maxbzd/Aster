import { describe, expect, it } from 'vitest'
import { matchPeople, normName, type Named } from '@/bridge/match'

const p = (id: string, name: string, aliases: string[] = [], archived = false): Named => ({ id, name, aliases, archived })

describe('matchPeople', () => {
  it('the same full name (in any order, ё/е) links on its own', () => {
    const r = matchPeople([p('a1', 'Алёна Воронцова'), p('a2', 'Борис Катин')], [p('o1', 'воронцова алена'), p('o2', 'Кто-то')], [])
    expect(r.auto).toEqual([{ localId: 'a1', peerId: 'o1' }])
  })

  it('an ambiguous name does not link on its own but is offered to the person', () => {
    const r = matchPeople([p('a1', 'Иван Иванов')], [p('o1', 'Иван Иванов'), p('o2', 'Иван Иванов')], [])
    expect(r.auto).toEqual([])
    expect(r.candidates.map(c => c.peerId).sort()).toEqual(['o1', 'o2'])
  })

  it('a first name only, without a last name: a suggestion, not an auto-link', () => {
    const r = matchPeople([p('a1', 'Алина')], [p('o1', 'Алина Воронцова')], [])
    expect(r.auto).toEqual([])
    expect(r.candidates).toEqual([expect.objectContaining({ localId: 'a1', peerId: 'o1', score: 60 })])
  })

  it('different people with the same first name but different last names do not match', () => {
    const r = matchPeople([p('a1', 'Алина Воронцова')], [p('o1', 'Алина Соколова')], [])
    expect(r.auto).toEqual([])
    expect(r.candidates).toEqual([])
  })

  it('similar last names (Иванов / Иванова): a weak suggestion', () => {
    const r = matchPeople([p('a1', 'Мария Иванова')], [p('o1', 'Мария Иванов')], [])
    expect(r.candidates[0]).toMatchObject({ score: 55, reason: 'Похожая фамилия' })
  })

  it('an alias matched', () => {
    const r = matchPeople([p('a1', 'Саша', ['Александр Петров'])], [p('o1', 'Александр Петров')], [])
    expect(r.auto).toEqual([{ localId: 'a1', peerId: 'o1' }])
  })

  it('does not touch already linked and broken pairs', () => {
    const mine = [p('a1', 'Алина Воронцова'), p('a2', 'Борис Катин')]
    const theirs = [p('o1', 'Алина Воронцова'), p('o2', 'Борис Катин')]
    const r = matchPeople(mine, theirs, [{ localId: 'a1', peerId: 'o1' }], [{ localId: 'a2', peerId: 'o2' }])
    expect(r.auto).toEqual([])
    expect(r.candidates.find(c => c.localId === 'a2' && c.peerId === 'o2')).toBeUndefined()
  })

  it('does not suggest archived people', () => {
    const r = matchPeople([p('a1', 'Алина Воронцова', [], true)], [p('o1', 'Алина Воронцова')], [])
    expect(r.auto).toEqual([])
  })

  it('one person does not get two links', () => {
    const r = matchPeople([p('a1', 'Алина Воронцова')], [p('o1', 'Алина Воронцова')], [])
    expect(r.auto).toHaveLength(1)
    expect(r.candidates).toEqual([])
  })

  it('normName', () => {
    expect(normName('  Ёлкин-Палкин, А.  ')).toBe('елкин палкин а')
  })
})
