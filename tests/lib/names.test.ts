import { describe, expect, it } from 'vitest'
import { nameScore, nameVariants, normalize, searchByName, skeleton } from '@/lib/names'

const p = (firstName: string, lastName?: string, nickname?: string) => ({ firstName, lastName, nickname })

describe('skeleton: the Russian and Latin spellings match', () => {
  it.each([
    ['Алексей', 'Alexey'], ['Алексей', 'Alexei'], ['Алексей', 'Aleksey'], ['Сергей', 'Sergey'], ['Сергей', 'Sergei'],
    ['Евгений', 'Evgeny'], ['Евгений', 'Yevgeny'], ['Дмитрий', 'Dmitry'], ['Дмитрий', 'Dmitri'], ['Юрий', 'Yuri'],
    ['Юлия', 'Julia'], ['Юлия', 'Yulia'], ['Мария', 'Maria'], ['Анна', 'Anna'], ['Максим', 'Maxim'], ['Михаил', 'Mikhail'],
    ['Фёдор', 'Fyodor'], ['Фёдор', 'Fedor'], ['Екатерина', 'Ekaterina'], ['Анастасия', 'Anastasia'], ['Вячеслав', 'Vyacheslav'],
    ['Воронцова', 'Vorontsova'], ['Щербаков', 'Shcherbakov'], ['Хасан', 'Hasan'], ['Хасан', 'Khasan'],
  ])('%s ≈ %s', (ru, en) => {
    expect(skeleton(ru)).toBe(skeleton(en))
  })
  it('different names do not match', () => {
    expect(skeleton('Алексей')).not.toBe(skeleton('Алексия'))
    expect(skeleton('Анна')).not.toBe(skeleton('Инна'))
    expect(skeleton('Максим')).not.toBe(skeleton('Марк'))
  })
  it('case, ё and punctuation do not matter', () => {
    expect(skeleton('  ЁЛКИН-палкин ')).toBe(skeleton('elkin palkin'))
    expect(normalize('Álvaro  Müller')).toBe('alvaro muller')
  })
})

describe('search by name', () => {
  const people = [p('Алексей', 'Петров'), p('Александр', 'Смирнов'), p('Александра', 'Орлова'), p('Дмитрий', 'Волков'), p('Мария', 'Иванова'), p('Евгения', 'Лаврова'), p('Hasan', 'Aliev')]
  const names = (q: string) => searchByName(q, people).map(x => x.firstName)

  it('"Alexey" finds "Алексей"', () => {
    expect(names('Alexey')[0]).toBe('Алексей')
    expect(names('alexei')[0]).toBe('Алексей')
    expect(names('Aleksey Petrov')).toEqual(['Алексей'])
  })
  it('"Саша" finds both Alexander and Alexandra', () => {
    expect(names('Саша').sort()).toEqual(['Александр', 'Александра'])
    expect(names('Sasha').sort()).toEqual(['Александр', 'Александра'])
    expect(names('Alex').sort()).toEqual(['Алексей', 'Александр', 'Александра'].sort())
  })
  it('short forms and English forms', () => {
    expect(names('Дима')).toEqual(['Дмитрий'])
    expect(names('Dmitry')).toEqual(['Дмитрий'])
    expect(names('Masha')).toEqual(['Мария'])
    expect(names('Zhenya')).toEqual(['Евгения'])
  })
  it('the start of a word: typing letter by letter', () => {
    expect(names('Алекс').length).toBe(3)
    expect(names('Alek').length).toBe(3)
    expect(names('Mar')).toEqual(['Мария'])
  })
  it('the other way round: the name is written in Latin, the search is in Russian', () => {
    expect(names('Хасан')).toEqual(['Hasan'])
    expect(names('Алиев')).toEqual(['Hasan'])
  })
  it('all words of the query are needed', () => {
    expect(names('Алексей Смирнов')).toEqual([])
    expect(names('Александр Смирнов')).toEqual(['Александр'])
  })
  it('garbage and an empty query find nothing', () => {
    expect(names('')).toEqual([])
    expect(names('   ')).toEqual([])
    expect(names('Zzzzz')).toEqual([])
  })
  it('an exact match ranks above a short form', () => {
    expect(nameScore('Александр', p('Александр'))).toBeGreaterThan(nameScore('Саша', p('Александр')))
  })
  it('an alias takes part too', () => {
    expect(nameScore('Wolf', p('Иван', 'Волков', 'Wolf'))).toBeGreaterThan(0)
    expect(nameScore('Вольф', p('Иван', 'Волков', 'Wolf'))).toBeGreaterThan(0)
  })
  it('short names give no false matches', () => {
    expect(names('Ян')).toEqual([])
    expect(nameScore('Ли', p('Алина'))).toBe(0)
  })
})

describe('nameVariants', () => {
  it('contains all forms of the name', () => {
    const v = nameVariants('Саша')
    expect(v).toEqual(expect.arrayContaining(['александр', 'александра', 'alex', 'sasha']))
  })
  it('an unknown name returns itself', () => {
    expect(nameVariants('Зинаида')).toEqual(['зинаида'])
  })
})
