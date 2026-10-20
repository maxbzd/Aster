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

describe('reserve: operations', () => {
  it('blankLead: unique ids and empty collections', () => {
    const a = blankLead()
    const b = blankLead()
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ tags: [], channels: [], firstName: '' })
  })
  it('saveLead updates updatedAt', async () => {
    const l = lead({ updatedAt: 1 })
    await saveLead(l)
    expect((await db.leads.get(l.id))?.updatedAt).toBe(NOW)
  })
  it('addLeads / deleteLeads', async () => {
    await addLeads([lead({ id: 'a' }), lead({ id: 'b' }), lead({ id: 'c' })])
    await deleteLeads(['a', 'c'])
    expect((await db.leads.toArray()).map(l => l.id)).toEqual(['b'])
  })
  it('patchLeads changes the selected ones and skips non-existent ones', async () => {
    await addLeads([lead({ id: 'a', tags: ['x'] }), lead({ id: 'b', tags: [] })])
    await patchLeads(['a', 'нет'], l => ({ tags: [...l.tags, 'новый'], star: true }))
    expect(await db.leads.get('a')).toMatchObject({ tags: ['x', 'новый'], star: true, updatedAt: NOW })
    expect((await db.leads.get('b'))?.star).toBeUndefined()
  })
  it('undoBatch deletes only its own batch', async () => {
    await addLeads([lead({ id: 'a', batchId: 'B1' }), lead({ id: 'b', batchId: 'B1' }), lead({ id: 'c', batchId: 'B2' }), lead({ id: 'd' })])
    expect(await undoBatch('B1')).toBe(2)
    expect((await db.leads.toArray()).map(l => l.id).sort()).toEqual(['c', 'd'])
    expect(await undoBatch('нет такой')).toBe(0)
  })
})

describe('promoteLead: reserve → network', () => {
  const full = () => lead({
    id: 'L', firstName: 'Давид', lastName: 'Шварц', company: 'Northwind', role: 'Партнёр', city: 'Дубай', why: 'Инвестирует в seed', source: 'Web Summit',
    tags: ['Инвестор'], channels: [{ type: 'telegram', value: 'dshwarz' }], notes: 'Любит кофе', star: true,
  })
  it('moves the fields, deletes the lead, returns the new person\'s id', async () => {
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
  it('a non-existent lead: undefined and the database does not change', async () => {
    expect(await promoteLead('нет', { closeness: 3 })).toBeUndefined()
    expect(await db.people.count()).toBe(0)
  })
  it('a strong contact becomes a favourite only if it was strong', async () => {
    await addLeads([lead({ id: 'M' })])
    const id = await promoteLead('M', { closeness: 3 })
    expect((await db.people.get(id as string))?.pinned).toBeUndefined()
  })
})

describe('exporting the reserve to CSV', () => {
  const l = lead({
    firstName: 'Анна', lastName: 'Ким', company: 'Acme, Inc', role: 'CTO', city: 'Алматы', why: 'Сказала "да"\nи ушла', source: 'Чат', tags: ['Юрист', 'AI'],
    channels: [{ type: 'phone', value: '+7 700 1' }, { type: 'email', value: 'a@k.im' }, { type: 'telegram', value: 'anna' }], star: true,
  })
  it('starts with a BOM (Excel) and a header, escapes commas, quotes and line breaks', () => {
    const csv = leadsToCSV([l])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.split('\r\n')[0]).toBe('﻿Имя,Фамилия,Компания,Должность,Телефон,Email,Telegram,Instagram,LinkedIn,Сайт,Город,Теги,Чем ценен,Откуда,Заметка,Сильный')
    expect(csv).toContain('"Acme, Inc"')
    expect(csv).toContain('"Сказала ""да""\nи ушла"')
  })
  it('export → import: what was exported loads back without loss', () => {
    const rows = parseDelimited(leadsToCSV([l, lead({ firstName: 'Борис', channels: [] })]).replace(/^﻿/, ''))
    expect(detectHeader(rows)).toBe(true)
    const roles = guessRoles(rows[0], rows.slice(1))
    const back = rowToParsed(rows[1], roles, { autoTags: false })
    expect(back).toMatchObject({ firstName: 'Анна', lastName: 'Ким', company: 'Acme, Inc', role: 'CTO', city: 'Алматы', why: 'Сказала "да"\nи ушла', source: 'Чат' })
    expect(back?.tags).toEqual(['Юрист', 'AI'])
    expect(back?.channels).toEqual(expect.arrayContaining([{ type: 'email', value: 'a@k.im' }, { type: 'telegram', value: 'anna' }]))
  })
})
