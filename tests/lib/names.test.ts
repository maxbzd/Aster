import { describe, expect, it } from 'vitest'
import { nameScore, nameVariants, normalize, searchByName, skeleton } from '@/lib/names'

const p = (firstName: string, lastName?: string, nickname?: string) => ({ firstName, lastName, nickname })

describe('skeleton: русское и латинское написание совпадают', () => {
  it.each([
    ['Алексей', 'Alexey'], ['Алексей', 'Alexei'], ['Алексей', 'Aleksey'], ['Сергей', 'Sergey'], ['Сергей', 'Sergei'],
    ['Евгений', 'Evgeny'], ['Евгений', 'Yevgeny'], ['Дмитрий', 'Dmitry'], ['Дмитрий', 'Dmitri'], ['Юрий', 'Yuri'],
    ['Юлия', 'Julia'], ['Юлия', 'Yulia'], ['Мария', 'Maria'], ['Анна', 'Anna'], ['Максим', 'Maxim'], ['Михаил', 'Mikhail'],
    ['Фёдор', 'Fyodor'], ['Фёдор', 'Fedor'], ['Екатерина', 'Ekaterina'], ['Анастасия', 'Anastasia'], ['Вячеслав', 'Vyacheslav'],
    ['Воронцова', 'Vorontsova'], ['Щербаков', 'Shcherbakov'], ['Хасан', 'Hasan'], ['Хасан', 'Khasan'],
  ])('%s ≈ %s', (ru, en) => {
    expect(skeleton(ru)).toBe(skeleton(en))
  })
  it('разные имена не совпадают', () => {
    expect(skeleton('Алексей')).not.toBe(skeleton('Алексия'))
    expect(skeleton('Анна')).not.toBe(skeleton('Инна'))
    expect(skeleton('Максим')).not.toBe(skeleton('Марк'))
  })
  it('регистр, ё и знаки не важны', () => {
    expect(skeleton('  ЁЛКИН-палкин ')).toBe(skeleton('elkin palkin'))
    expect(normalize('Álvaro  Müller')).toBe('alvaro muller')
  })
})

describe('поиск по имени', () => {
  const people = [p('Алексей', 'Петров'), p('Александр', 'Смирнов'), p('Александра', 'Орлова'), p('Дмитрий', 'Волков'), p('Мария', 'Иванова'), p('Евгения', 'Лаврова'), p('Hasan', 'Aliev')]
  const names = (q: string) => searchByName(q, people).map(x => x.firstName)

  it('«Alexey» находит «Алексея»', () => {
    expect(names('Alexey')[0]).toBe('Алексей')
    expect(names('alexei')[0]).toBe('Алексей')
    expect(names('Aleksey Petrov')).toEqual(['Алексей'])
  })
  it('«Саша» находит и Александра, и Александру', () => {
    expect(names('Саша').sort()).toEqual(['Александр', 'Александра'])
    expect(names('Sasha').sort()).toEqual(['Александр', 'Александра'])
    expect(names('Alex').sort()).toEqual(['Алексей', 'Александр', 'Александра'].sort())
  })
  it('уменьшительные и английские формы', () => {
    expect(names('Дима')).toEqual(['Дмитрий'])
    expect(names('Dmitry')).toEqual(['Дмитрий'])
    expect(names('Masha')).toEqual(['Мария'])
    expect(names('Zhenya')).toEqual(['Евгения'])
  })
  it('начало слова: ввод по буквам', () => {
    expect(names('Алекс').length).toBe(3)
    expect(names('Alek').length).toBe(3)
    expect(names('Mar')).toEqual(['Мария'])
  })
  it('обратная сторона: имя записано латиницей, ищут по-русски', () => {
    expect(names('Хасан')).toEqual(['Hasan'])
    expect(names('Алиев')).toEqual(['Hasan'])
  })
  it('нужны все слова запроса', () => {
    expect(names('Алексей Смирнов')).toEqual([])
    expect(names('Александр Смирнов')).toEqual(['Александр'])
  })
  it('мусор и пустой запрос ничего не находят', () => {
    expect(names('')).toEqual([])
    expect(names('   ')).toEqual([])
    expect(names('Zzzzz')).toEqual([])
  })
  it('точное совпадение выше уменьшительного', () => {
    expect(nameScore('Александр', p('Александр'))).toBeGreaterThan(nameScore('Саша', p('Александр')))
  })
  it('псевдоним тоже участвует', () => {
    expect(nameScore('Wolf', p('Иван', 'Волков', 'Wolf'))).toBeGreaterThan(0)
    expect(nameScore('Вольф', p('Иван', 'Волков', 'Wolf'))).toBeGreaterThan(0)
  })
  it('короткие имена не дают ложных совпадений', () => {
    expect(names('Ян')).toEqual([])
    expect(nameScore('Ли', p('Алина'))).toBe(0)
  })
})

describe('nameVariants', () => {
  it('содержит все формы имени', () => {
    const v = nameVariants('Саша')
    expect(v).toEqual(expect.arrayContaining(['александр', 'александра', 'alex', 'sasha']))
  })
  it('неизвестное имя возвращает себя', () => {
    expect(nameVariants('Зинаида')).toEqual(['зинаида'])
  })
})
