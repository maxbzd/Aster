import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/data/db'
import { addLeads, blankLead, deleteLeads, leadsToCSV, patchLeads, promoteLead, saveLead, undoBatch } from '@/data/leads'
import { parseDelimited } from '@/lib/tabular'
import { detectHeader, guessRoles, rowToParsed } from '@/data/leadParse'
import { NOW, lead, resetDb } from '../helpers'

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

describe('резерв: операции', () => {
  it('blankLead — уникальные id и пустые коллекции', () => {
    const a = blankLead()
    const b = blankLead()
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ tags: [], channels: [], firstName: '' })
  })
  it('saveLead обновляет updatedAt', async () => {
    const l = lead({ updatedAt: 1 })
    await saveLead(l)
    expect((await db.leads.get(l.id))?.updatedAt).toBe(NOW)
  })
  it('addLeads / deleteLeads', async () => {
    await addLeads([lead({ id: 'a' }), lead({ id: 'b' }), lead({ id: 'c' })])
    await deleteLeads(['a', 'c'])
    expect((await db.leads.toArray()).map(l => l.id)).toEqual(['b'])
  })
  it('patchLeads меняет выбранные и пропускает несуществующие', async () => {
    await addLeads([lead({ id: 'a', tags: ['x'] }), lead({ id: 'b', tags: [] })])
    await patchLeads(['a', 'нет'], l => ({ tags: [...l.tags, 'новый'], star: true }))
    expect(await db.leads.get('a')).toMatchObject({ tags: ['x', 'новый'], star: true, updatedAt: NOW })
    expect((await db.leads.get('b'))?.star).toBeUndefined()
  })
  it('undoBatch удаляет только свою пачку', async () => {
    await addLeads([lead({ id: 'a', batchId: 'B1' }), lead({ id: 'b', batchId: 'B1' }), lead({ id: 'c', batchId: 'B2' }), lead({ id: 'd' })])
    expect(await undoBatch('B1')).toBe(2)
    expect((await db.leads.toArray()).map(l => l.id).sort()).toEqual(['c', 'd'])
    expect(await undoBatch('нет такой')).toBe(0)
  })
})

describe('promoteLead — резерв → сеть', () => {
  const full = () => lead({
    id: 'L', firstName: 'Давид', lastName: 'Шварц', company: 'Northwind', role: 'Партнёр', city: 'Дубай', why: 'Инвестирует в seed', source: 'Web Summit',
    tags: ['Инвестор'], channels: [{ type: 'telegram', value: 'dshwarz' }], notes: 'Любит кофе', star: true,
  })
  it('переносит поля, удаляет лид, возвращает id нового человека', async () => {
    await addLeads([full()])
    const id = await promoteLead('L', { closeness: 2, circleIds: ['c1'] })
    expect(id).toBeTruthy()
    expect(await db.leads.get('L')).toBeUndefined()
    const p = await db.people.get(id as string)
    expect(p).toMatchObject({
      firstName: 'Давид', lastName: 'Шварц', company: 'Northwind', role: 'Партнёр', city: 'Дубай', tags: ['Инвестор'], closeness: 2, circleIds: ['c1'],
      canHelpMe: 'Инвестирует в seed', metPlace: 'Web Summit', notes: 'Любит кофе', pinned: true,
    })
    expect(p?.channels).toEqual([{ type: 'telegram', value: 'dshwarz' }])
  })
  it('несуществующий лид — undefined и база не меняется', async () => {
    expect(await promoteLead('нет', { closeness: 3 })).toBeUndefined()
    expect(await db.people.count()).toBe(0)
  })
  it('сильный контакт становится избранным только если был сильным', async () => {
    await addLeads([lead({ id: 'M' })])
    const id = await promoteLead('M', { closeness: 3 })
    expect((await db.people.get(id as string))?.pinned).toBeUndefined()
  })
})

describe('экспорт резерва в CSV', () => {
  const l = lead({
    firstName: 'Анна', lastName: 'Ким', company: 'Acme, Inc', role: 'CTO', city: 'Алматы', why: 'Сказала "да"\nи ушла', source: 'Чат', tags: ['Юрист', 'AI'],
    channels: [{ type: 'phone', value: '+7 700 1' }, { type: 'email', value: 'a@k.im' }, { type: 'telegram', value: 'anna' }], star: true,
  })
  it('начинается с BOM (Excel) и шапки, экранирует запятые, кавычки и переносы', () => {
    const csv = leadsToCSV([l])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.split('\r\n')[0]).toBe('﻿Имя,Фамилия,Компания,Должность,Телефон,Email,Telegram,Instagram,LinkedIn,Сайт,Город,Теги,Чем ценен,Откуда,Заметка,Сильный')
    expect(csv).toContain('"Acme, Inc"')
    expect(csv).toContain('"Сказала ""да""\nи ушла"')
  })
  it('экспорт → импорт: то, что выгрузили, загружается обратно без потерь', () => {
    const rows = parseDelimited(leadsToCSV([l, lead({ firstName: 'Борис', channels: [] })]).replace(/^﻿/, ''))
    expect(detectHeader(rows)).toBe(true)
    const roles = guessRoles(rows[0], rows.slice(1))
    const back = rowToParsed(rows[1], roles, { autoTags: false })
    expect(back).toMatchObject({ firstName: 'Анна', lastName: 'Ким', company: 'Acme, Inc', role: 'CTO', city: 'Алматы', why: 'Сказала "да"\nи ушла', source: 'Чат' })
    expect(back?.tags).toEqual(['Юрист', 'AI'])
    expect(back?.channels).toEqual(expect.arrayContaining([{ type: 'email', value: 'a@k.im' }, { type: 'telegram', value: 'anna' }]))
  })
})
