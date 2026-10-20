import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKUP_VERSION, BackupError, DEFAULT_CIRCLES, backupToFile, blankPerson, deleteInteraction, deletePerson, exportBackup, importBackup, logInteraction, patchPerson,
  patchAi, recomputeLastContact, savePerson, saveSettings, setCircles, snooze, toggleReminder, addReminder, deleteReminder, wipeAll, wipeNetwork, validateBackup,
} from '@/data/actions'
import { db } from '@/data/db'
import { DAY } from '@/lib/format'
import { download } from '@/lib/ics'
import { NOW, interaction, lead, person, reminder, resetDb } from '../helpers'

vi.mock('@/lib/ics', async orig => ({ ...(await orig<typeof import('@/lib/ics')>()), download: vi.fn() }))

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

describe('people', () => {
  it('blankPerson gives a valid blank with a unique id', () => {
    const a = blankPerson()
    const b = blankPerson()
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ circleIds: [], tags: [], channels: [], facts: [], topics: [], links: [], closeness: 3 })
  })
  it('savePerson updates updatedAt, and so does patchPerson', async () => {
    const p = person({ updatedAt: 1 })
    await savePerson(p)
    expect((await db.people.get(p.id))?.updatedAt).toBe(NOW)
    vi.setSystemTime(NOW + 5000)
    await patchPerson(p.id, { company: 'Acme' })
    const saved = await db.people.get(p.id)
    expect(saved).toMatchObject({ company: 'Acme', updatedAt: NOW + 5000 })
  })
})

describe('deletePerson: the cascade', () => {
  it('removes the person, their reminders, links on others and "introduced by"', async () => {
    const a = person({ id: 'a' })
    const b = person({ id: 'b', links: [{ personId: 'a', label: 'коллега' }, { personId: 'c', label: 'друг' }], introducedBy: 'a' })
    const c = person({ id: 'c' })
    await db.people.bulkPut([a, b, c])
    await db.reminders.bulkPut([reminder({ id: 'r1', personId: 'a' }), reminder({ id: 'r2', personId: 'c' })])
    await deletePerson('a')
    expect(await db.people.get('a')).toBeUndefined()
    expect((await db.reminders.toArray()).map(r => r.id)).toEqual(['r2'])
    const bAfter = await db.people.get('b')
    expect(bAfter?.links).toEqual([{ personId: 'c', label: 'друг' }])
    expect(bAfter?.introducedBy).toBeUndefined()
  })
  it('shared records stay with the other participants, personal ones are deleted', async () => {
    await db.people.bulkPut([person({ id: 'a' }), person({ id: 'b' })])
    await db.interactions.bulkPut([
      interaction({ id: 'solo', personIds: ['a'] }),
      interaction({ id: 'shared', personIds: ['a', 'b'] }),
    ])
    await deletePerson('a')
    const left = await db.interactions.toArray()
    expect(left.map(i => i.id)).toEqual(['shared'])
    expect(left[0].personIds).toEqual(['b'])
  })
})

describe('interactions and the last contact', () => {
  it('logInteraction updates lastContactAt for all participants and clears "snooze"', async () => {
    await db.people.bulkPut([person({ id: 'a', snoozedUntil: NOW + 7 * DAY }), person({ id: 'b' })])
    await logInteraction({ personIds: ['a', 'b'], type: 'meeting', date: NOW - 2 * DAY })
    expect((await db.people.get('a'))?.lastContactAt).toBe(NOW - 2 * DAY)
    expect((await db.people.get('b'))?.lastContactAt).toBe(NOW - 2 * DAY)
    expect((await db.people.get('a'))?.snoozedUntil).toBeUndefined()
  })
  it('a note does not count as contact', async () => {
    await db.people.put(person({ id: 'a' }))
    await logInteraction({ personIds: ['a'], type: 'note', date: NOW })
    expect((await db.people.get('a'))?.lastContactAt).toBeUndefined()
  })
  it('lastContactAt is the latest record, not the last one added', async () => {
    await db.people.put(person({ id: 'a' }))
    await logInteraction({ personIds: ['a'], type: 'call', date: NOW - DAY })
    await logInteraction({ personIds: ['a'], type: 'call', date: NOW - 10 * DAY })
    expect((await db.people.get('a'))?.lastContactAt).toBe(NOW - DAY)
  })
  it('deleting the last record rolls lastContactAt back to the previous one', async () => {
    await db.people.put(person({ id: 'a' }))
    await logInteraction({ personIds: ['a'], type: 'call', date: NOW - 10 * DAY })
    const last = await logInteraction({ personIds: ['a'], type: 'call', date: NOW - DAY })
    await deleteInteraction(last)
    expect((await db.people.get('a'))?.lastContactAt).toBe(NOW - 10 * DAY)
  })
  it('deleting the only record resets lastContactAt', async () => {
    await db.people.put(person({ id: 'a' }))
    const only = await logInteraction({ personIds: ['a'], type: 'call', date: NOW - DAY })
    await deleteInteraction(only)
    expect((await db.people.get('a'))?.lastContactAt).toBeUndefined()
    await recomputeLastContact('a')
    await deleteInteraction('нет такой') // does not crash
  })
})

describe('reminders and snooze', () => {
  it('creating, toggling done/not done, deleting', async () => {
    const id = await addReminder({ text: 'Позвонить', dueAt: NOW + DAY, personId: 'a' })
    expect(await db.reminders.get(id)).toMatchObject({ done: false, createdAt: NOW })
    await toggleReminder(id)
    expect(await db.reminders.get(id)).toMatchObject({ done: true, doneAt: NOW })
    await toggleReminder(id)
    expect((await db.reminders.get(id))?.done).toBe(false)
    expect((await db.reminders.get(id))?.doneAt).toBeUndefined()
    await deleteReminder(id)
    expect(await db.reminders.get(id)).toBeUndefined()
    await toggleReminder('нет такого') // does not crash
  })
  it('snooze postpones by N days', async () => {
    await db.people.put(person({ id: 'a' }))
    await snooze('a', 3)
    expect((await db.people.get('a'))?.snoozedUntil).toBe(NOW + 3 * DAY)
  })
})

describe('settings and circles', () => {
  it('saveSettings creates the row and then merges fields', async () => {
    await saveSettings({ name: 'Макс' })
    await saveSettings({ onboarded: true })
    expect(await db.settings.get('me')).toMatchObject({ name: 'Макс', onboarded: true })
    expect(await db.settings.count()).toBe(1)
  })
  it('setCircles replaces the circles and numbers the order', async () => {
    await setCircles(DEFAULT_CIRCLES)
    await setCircles(DEFAULT_CIRCLES.slice(0, 2))
    const circles = await db.circles.orderBy('order').toArray()
    expect(circles.map(c => c.name)).toEqual(['Работа', 'Друзья'])
    expect(circles.map(c => c.order)).toEqual([0, 1])
  })
})

describe('patchAi: Astra\'s settings without lost updates', () => {
  const defaults = { mode: 'off' as const, model: 'claude-opus-5-5', shareNotes: true, webSearch: false }
  it('simultaneous edits do not overwrite each other', async () => {
    await saveSettings({ name: 'Макс' })
    await Promise.all([patchAi({ apiKey: 'k' }, defaults), patchAi({ consentAt: 5 }, defaults), patchAi({ model: 'claude-sonnet-5-5' }, defaults), patchAi({ mode: 'key' }, defaults)])
    expect((await db.settings.get('me'))?.ai).toMatchObject({ apiKey: 'k', consentAt: 5, model: 'claude-sonnet-5-5', mode: 'key', shareNotes: true })
    expect((await db.settings.get('me'))?.name).toBe('Макс')
  })
  it('on an empty database it creates the settings', async () => {
    await patchAi({ mode: 'proxy' }, defaults)
    expect((await db.settings.get('me'))?.ai?.mode).toBe('proxy')
  })
})

describe('wipe', () => {
  beforeEach(async () => {
    await saveSettings({ name: 'Макс', onboarded: true, ai: { mode: 'key', apiKey: 'sk-x', model: 'm', shareNotes: false, webSearch: false } })
    await db.people.put(person())
    await db.leads.put(lead())
    await db.interactions.put(interaction({ personIds: ['x'] }))
    await db.aiCache.put({ key: 'k', at: 1, value: 1 })
  })
  it('wipeAll clears absolutely everything, including the reserve and the settings', async () => {
    await wipeAll()
    for (const t of db.tables) expect(await t.count()).toBe(0)
  })
  it('wipeNetwork clears people and the reserve but keeps the settings', async () => {
    await wipeNetwork()
    expect(await db.people.count()).toBe(0)
    expect(await db.leads.count()).toBe(0)
    expect(await db.aiCache.count()).toBe(0)
    expect((await db.settings.get('me'))?.ai?.apiKey).toBe('sk-x')
  })
})

describe('backup', () => {
  beforeEach(async () => {
    await saveSettings({ name: 'Макс', onboarded: true, createdAt: 1, ai: { mode: 'key', apiKey: 'sk-secret', proxyToken: 'tok', model: 'claude-opus-5-5', shareNotes: true, webSearch: false, consentAt: 5 } })
    await db.people.bulkPut([person({ id: 'a', firstName: 'Анна' }), person({ id: 'b', firstName: 'Борис' })])
    await db.interactions.put(interaction({ id: 'i', personIds: ['a'] }))
    await db.reminders.put(reminder({ id: 'r', personId: 'a' }))
    await db.circles.put({ id: 'c', name: 'Работа', emoji: '💼', palette: 'ocean', order: 0 })
    await db.leads.put(lead({ id: 'l', firstName: 'Лид' }))
  })

  it('the export contains all tables and the version, but not the keys', async () => {
    const data = await exportBackup()
    expect(data).toMatchObject({ app: 'aster', version: BACKUP_VERSION })
    expect(data.people).toHaveLength(2)
    expect(data.leads).toHaveLength(1)
    const text = JSON.stringify(data)
    expect(text).not.toContain('sk-secret')
    expect(text).not.toContain('"tok"')
  })

  it('export → erase → import restores the data, the key stays as it was', async () => {
    const json = JSON.parse(JSON.stringify(await exportBackup()))
    await db.people.clear()
    await db.leads.clear()
    await db.settings.update('me', { ai: { mode: 'key', apiKey: 'новый-ключ', model: 'm2', shareNotes: false, webSearch: false } })
    const loaded = await importBackup(json)
    expect(loaded).toBe(2 + 1 + 1 + 1 + 1)
    expect((await db.people.toArray()).map(p => p.firstName).sort()).toEqual(['Анна', 'Борис'])
    expect(await db.leads.count()).toBe(1)
    const s = await db.settings.get('me')
    expect(s?.ai?.apiKey).toBe('новый-ключ')
    expect(s?.name).toBe('Макс')
    expect(s?.onboarded).toBe(true)
  })

  it('"replace" mode deletes what is not in the backup', async () => {
    const json = JSON.parse(JSON.stringify(await exportBackup()))
    await db.people.put(person({ id: 'extra', firstName: 'Лишний' }))
    await importBackup(json)
    expect(await db.people.get('extra')).toBeUndefined()
  })

  it('"merge" mode adds without deleting anything; on an id clash the backup wins', async () => {
    const json = JSON.parse(JSON.stringify(await exportBackup()))
    json.people[0].company = 'Из копии'
    await db.people.put(person({ id: 'extra', firstName: 'Лишний' }))
    await db.settings.update('me', { name: 'Не трогать' })
    await importBackup(json, { mode: 'merge' })
    expect(await db.people.get('extra')).toBeDefined()
    expect((await db.people.toArray()).some(p => p.company === 'Из копии')).toBe(true)
    expect((await db.settings.get('me'))?.name).toBe('Не трогать')
  })

  it('a backup from an old version without the reserve does not erase the current reserve', async () => {
    const json = JSON.parse(JSON.stringify(await exportBackup()))
    delete json.leads
    json.version = 2
    await importBackup(json)
    expect(await db.leads.count()).toBe(1)
  })

  it('an import into an empty database (a new device) finishes onboarding', async () => {
    const json = JSON.parse(JSON.stringify(await exportBackup()))
    await wipeAll()
    await importBackup(json)
    expect((await db.settings.get('me'))?.onboarded).toBe(true)
  })

  describe('validation protects the data', () => {
    const bad: [string, unknown, RegExp][] = [
      ['не объект', 'строка', /не резервная копия/],
      ['чужое приложение', { app: 'other' }, /не резервная копия/],
      ['null', null, /не резервная копия/],
      ['версия из будущего', { app: 'aster', version: 99 }, /новой версии/],
      ['people не список', { app: 'aster', people: {} }, /списком/],
      ['запись без id', { app: 'aster', people: [{ firstName: 'А' }] }, /идентификатора/],
      ['человек без имени', { app: 'aster', people: [{ id: 'x' }] }, /нет имени/],
      ['контакт резерва без имени', { app: 'aster', leads: [{ id: 'x' }] }, /нет имени/],
      ['запись общения без участников', { app: 'aster', interactions: [{ id: 'x' }] }, /нет участников/],
    ]
    it.each(bad)('%s → an error, the database is untouched', async (_, data, re) => {
      await expect(importBackup(data)).rejects.toThrow(re)
      await expect(importBackup(data)).rejects.toBeInstanceOf(BackupError)
      expect(await db.people.count()).toBe(2)
      expect(await db.leads.count()).toBe(1)
      expect((await db.settings.get('me'))?.ai?.apiKey).toBe('sk-secret')
    })
    it('validateBackup accepts a correct backup', () => {
      expect(() => validateBackup({ app: 'aster', version: BACKUP_VERSION, people: [{ id: 'x', firstName: 'А' }] })).not.toThrow()
    })
  })

  it('backupToFile downloads the file and remembers the date', async () => {
    await backupToFile()
    expect(download).toHaveBeenCalledTimes(1)
    const [name, text, type] = vi.mocked(download).mock.calls[0]
    expect(name).toBe('aster-backup-2026-10-05.json')
    expect(type).toBe('application/json')
    expect(JSON.parse(text as string).app).toBe('aster')
    expect((await db.settings.get('me'))?.lastBackupAt).toBe(NOW)
  })
})
