import { describe, expect, it } from 'vitest'
import {
  clauses, findMentioned, monthIndex, nameToNominative, parseBirthday, parseWhen, stem, stems, surnameToNominative, trimPunct, wordRe,
} from '@/ai/local/text'
import { NOW, person } from '../helpers'

describe('stem / stems', () => {
  it('strips Russian endings', () => {
    expect(stem('инвесторы')).toBe('инвестор')
    expect(stem('юристами')).toBe('юрист')
    expect(stem('дизайнера')).toBe('дизайнер')
  })
  it('leaves Latin and short words alone', () => {
    expect(stem('fintech')).toBe('fintech')
    expect(stem('ии')).toBe('ии')
    expect(stem('мир')).toBe('мир')
  })
  it('stems drops stop words and turns ё into е', () => {
    expect(stems('Кто может помочь с визой в ОАЭ?')).toEqual(['виз', 'оаэ'])
    expect(stems('Ёлка')).toEqual(['елк'])
  })
})

describe('wordRe: word boundaries for Cyrillic', () => {
  it('finds a whole word and does not find one inside another', () => {
    expect(wordRe('кот').test('мой кот спит')).toBe(true)
    expect(wordRe('кот').test('котлета')).toBe(false)
    expect(wordRe('кот').test('скот')).toBe(false)
    expect(wordRe('кот').test('кот, и пёс')).toBe(true)
  })
})

describe('names to the nominative case', () => {
  it.each([
    ['Артёмом', 'Артём'], ['Анной', 'Анна'], ['Сергеем', 'Сергей'], ['Дмитрием', 'Дмитрий'], ['Марией', 'Мария'],
    ['Олегом', 'Олег'], ['Игорем', 'Игорь'], ['Ильёй', 'Илья'], ['Максимом', 'Максим'],
  ])('%s → %s', (form, nom) => {
    expect(nameToNominative(form)).toBe(nom)
  })
  it('last names', () => {
    expect(surnameToNominative('Смирновым')).toBe('Смирнов')
    expect(surnameToNominative('Смирновой')).toBe('Смирнова')
    expect(surnameToNominative('Чайковским')).toBe('Чайковский')
  })
  it('trimPunct', () => {
    expect(trimPunct(' — привет, ')).toBe('привет')
    expect(trimPunct('текст...')).toBe('текст')
  })
})

describe('findMentioned: people mentioned in case forms', () => {
  const people = [person({ id: 'a', firstName: 'Артём' }), person({ id: 'n', firstName: 'Анна', lastName: 'Ким' }), person({ id: 'n2', firstName: 'Анна', lastName: 'Лим' }), person({ id: 'o', firstName: 'Олег' })]
  it('finds by oblique cases', () => {
    expect(findMentioned('Вчера говорил с Артёмом', people).map(p => p.id)).toEqual(['a'])
    expect(findMentioned('Встретил Олега и Артёма', people).map(p => p.id).sort()).toEqual(['a', 'o'])
  })
  it('with namesakes it picks the one whose last name is given', () => {
    expect(findMentioned('Написала Анна Лим по поводу сделки', people).map(p => p.id)).toEqual(['n2'])
  })
  it('does not confuse word parts and skips archived people', () => {
    expect(findMentioned('Олегарх пришёл', people)).toEqual([])
    expect(findMentioned('Артём', [person({ firstName: 'Артём', archived: true })])).toEqual([])
  })
})

describe('parseWhen: "when" from speech (today: Mon 5 October 2026)', () => {
  it.each([
    ['позвоню завтра', '2026-10-06'],
    ['напомни послезавтра', '2026-10-07'],
    ['через неделю', '2026-10-12'],
    ['через 3 дня', '2026-10-08'],
    ['через две недели', '2026-10-19'],
    ['через месяц', '2026-11-04'],
    ['через полгода', '2027-04-05'],
    ['в пятницу', '2026-10-09'],
    ['в понедельник', '2026-10-12'],
    ['в среду созвонимся', '2026-10-07'],
    ['на выходных', '2026-10-10'],
    ['в конце месяца', '2026-10-31'],
    ['20 октября', '2026-10-20'],
    ['14 мая', '2027-05-14'],
    ['в декабре', '2026-12-01'],
    ['после отпуска', '2026-10-26'],
    ['на днях', '2026-10-08'],
    ['через 2 часа', '2026-10-05'],
  ])('«%s» → %s', (text, iso) => {
    expect(parseWhen(text, NOW)).toBe(iso)
  })
  it('no date: null', () => {
    expect(parseWhen('просто поговорили', NOW)).toBeNull()
  })
  it('"завтра" does not fire inside a word', () => {
    expect(parseWhen('позавчера', NOW)).toBeNull()
  })
  it('months: май and its derivatives', () => {
    expect(monthIndex('мая')).toBe(4)
    expect(monthIndex('майский')).toBe(-1)
    expect(monthIndex('марта')).toBe(2)
    expect(monthIndex('декабря')).toBe(11)
  })
})

describe('parseBirthday', () => {
  it.each([
    ['день рождения 14 мая', '--05-14'],
    ['у неё день рождения 3 марта 1990', '1990-03-03'],
    ['родился 1 января 1985', '1985-01-01'],
    ['ДР 9 октября', '--10-09'],
  ])('«%s» → %s', (text, v) => {
    expect(parseBirthday(text)).toBe(v)
  })
  it('no date: null', () => {
    expect(parseBirthday('любит бегать')).toBeNull()
  })
})

describe('clauses', () => {
  it('splits into meaningful phrases', () => {
    const parts = clauses('Познакомились на конференции. Работает в финтехе, а живёт в Дубае! Обещал интро.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('Познакомились на конференции.')
  })
})
