import { beforeEach, describe, expect, it } from 'vitest'
import { addFamilyMember, ageOf, convertFamilyText, familyOfPerson, parseFamilyText, relationPhrase } from '@/data/family'
import { db } from '@/data/db'
import { NOW, person, resetDb } from '../helpers'

beforeEach(resetDb)

describe('parseFamilyText', () => {
  it('understands relation words and names', () => {
    const r = parseFamilyText('Жена Маша, сын Лёва (5 лет), мама Ольга Петровна')
    expect(r.members).toEqual([
      { name: 'Маша', relation: 'partner' },
      { name: 'Лёва', relation: 'child', age: 5 },
      { name: 'Ольга Петровна', relation: 'parent' },
    ])
    expect(r.rest).toEqual([])
  })
  it('a husband, a daughter with an age, "и"', () => {
    const r = parseFamilyText('Муж Артём, дочь Ева (4 года)')
    expect(r.members.map(m => [m.name, m.relation, m.age])).toEqual([['Артём', 'partner', undefined], ['Ева', 'child', 4]])
    expect(parseFamilyText('Партнёр Жоау').members).toEqual([{ name: 'Жоау', relation: 'partner' }])
    expect(parseFamilyText('брат Игорь и сестра Анна').members.map(m => m.relation)).toEqual(['sibling', 'sibling'])
  })
  it('understands English relation words, ages and "and"', () => {
    const r = parseFamilyText('Wife Dana, son Leo (5 years old), mom Olga Smith, daughter Eve (4)')
    expect(r.members).toEqual([
      { name: 'Dana', relation: 'partner' },
      { name: 'Leo', relation: 'child', age: 5 },
      { name: 'Olga Smith', relation: 'parent' },
      { name: 'Eve', relation: 'child', age: 4 },
    ])
    expect(parseFamilyText('brother Igor and sister Anna').members.map(m => m.relation)).toEqual(['sibling', 'sibling'])
    expect(parseFamilyText('Partner João, a big family').rest).toEqual(['a big family'])
  })
  it('does not lose what it does not understand, returns it as is', () => {
    const r = parseFamilyText('Жена Маша, большая дружная семья, кот Барсик')
    expect(r.members).toHaveLength(1)
    expect(r.rest).toEqual(['большая дружная семья', 'кот Барсик'])
  })
  it('a relation word without a name does not count', () => {
    expect(parseFamilyText('сын').members).toEqual([])
  })
})

describe('ageOf', () => {
  it('computes the age for today; before the birthday they have not turned yet', () => {
    expect(ageOf('2020-10-05', NOW)).toBe(6)
    expect(ageOf('2020-10-06', NOW)).toBe(5)
    expect(ageOf('--10-05', NOW)).toBeNull()
    expect(ageOf(undefined, NOW)).toBeNull()
    expect(ageOf('2030-01-01', NOW)).toBeNull()
  })
})

describe('family as separate people', () => {
  it('a family member is created as a card with a birthday; the owner\'s last name is inherited (except the partner)', async () => {
    const owner = person({ id: 'o', firstName: 'Алина', lastName: 'Воронцова' })
    await db.people.add(owner)
    const kid = await addFamilyMember('o', { firstName: ' Ева ', relation: 'child', birthday: '2022-03-14' })
    const partner = await addFamilyMember('o', { firstName: 'Артём', relation: 'partner' })
    expect(await db.people.get(kid)).toMatchObject({ firstName: 'Ева', lastName: 'Воронцова', familyOf: 'o', relation: 'child', birthday: '2022-03-14' })
    expect((await db.people.get(partner))?.lastName).toBeUndefined()
  })

  it('order: partner, children from oldest to youngest, parents', () => {
    const all = [
      person({ id: 'o', firstName: 'Алина' }),
      person({ id: 'k2', firstName: 'Младший', familyOf: 'o', relation: 'child', birthday: '2022-01-01' }),
      person({ id: 'm', firstName: 'Мама', familyOf: 'o', relation: 'parent' }),
      person({ id: 'k1', firstName: 'Старший', familyOf: 'o', relation: 'child', birthday: '2015-01-01' }),
      person({ id: 'pt', firstName: 'Партнёр', familyOf: 'o', relation: 'partner' }),
      person({ id: 'x', firstName: 'Чужой', familyOf: 'другой', relation: 'child' }),
    ]
    expect(familyOfPerson(all, 'o').map(p => p.id)).toEqual(['pt', 'k1', 'k2', 'm'])
  })

  it('convertFamilyText turns text into cards and leaves the unrecognised part', async () => {
    await db.people.add(person({ id: 'o', firstName: 'Алина', lastName: 'Воронцова', family: 'Муж Артём, дочь Ева (4 года), собака Бим' }))
    const r = await convertFamilyText('o', NOW)
    expect(r.created).toBe(2)
    const members = (await db.people.toArray()).filter(p => p.familyOf === 'o')
    expect(members.map(m => m.firstName).sort()).toEqual(['Артём', 'Ева'])
    expect(members.find(m => m.firstName === 'Ева')?.notes).toMatch(/Возраст.*: 4/)
    expect(members.find(m => m.firstName === 'Ева')?.birthday).toBeUndefined() // we do not invent a date
    expect((await db.people.get('o'))?.family).toBe('собака Бим')
    // a repeated run does not make duplicates
    await db.people.update('o', { family: 'Муж Артём' })
    expect((await convertFamilyText('o', NOW)).created).toBe(0)
  })

  it('relationPhrase', () => {
    expect(relationPhrase(person({ relation: 'child', familyOf: 'o' }), person({ firstName: 'Алина' }))).toBe('Ребёнок · Алина')
    expect(relationPhrase(person({ relation: 'partner' }))).toBe('Партнёр')
  })
})
