import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUI } from '@/app/store'
import { db } from '@/data/db'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { renderApp, seed } from './harness'

const dialog = () => within(screen.getByRole('dialog'))
const open = (sheet: Parameters<ReturnType<typeof useUI.getState>['open']>[0]) => act(() => useUI.getState().open(sheet))

beforeEach(() => seed({ demo: false }))
afterEach(() => { act(() => useUI.getState().close()) })

describe('lists', () => {
  it('refuses a list without a name, then creates it with the people chosen for it', async () => {
    await db.people.bulkAdd([personOf('p1', { firstName: 'Ольга' }), personOf('p2', { firstName: 'Игорь' })])
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open({ kind: 'collectionEdit', addPersonIds: ['p1', 'p2'] })
    await screen.findByRole('dialog')
    await user.click(dialog().getByRole('button', { name: t('Create list') }))
    expect(await dialog().findByText(t('Give the list a name'))).toBeInTheDocument()
    expect(await db.collections.count()).toBe(0)

    await user.type(dialog().getByLabelText(t('List name')), 'К ужину')
    await user.click(dialog().getByRole('button', { name: t('Create list') }))
    await waitFor(async () => expect(await db.collections.count()).toBe(1))
    const list = (await db.collections.toArray())[0]!
    expect(list.name).toContain('К ужину')
    expect(list.personIds.sort()).toEqual(['p1', 'p2'])
  })

  it('a quick-start preset fills in the name, and a list can be deleted without losing its people', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга' }))
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open({ kind: 'collectionEdit', addPersonIds: ['p1'] })
    await screen.findByRole('dialog')
    const quick = dialog().getByText(t('Quick start')).parentElement!
    const preset = within(quick).getAllByRole('button')[0]!
    await user.click(preset)
    expect((dialog().getByLabelText(t('List name')) as HTMLInputElement).value).not.toBe('') // the preset named it
    await user.click(dialog().getByRole('button', { name: t('Create list') }))
    await waitFor(async () => expect(await db.collections.count()).toBe(1))
    const id = (await db.collections.toArray())[0]!.id

    act(() => useUI.getState().close())
    open({ kind: 'collectionEdit', id })
    await user.click(await dialog().findByRole('button', { name: t('Delete list') }))
    await user.click(await dialog().findByRole('button', { name: t('Really delete? The people stay') }))
    await waitFor(async () => expect(await db.collections.count()).toBe(0))
    expect(await db.people.get('p1')).toBeDefined()
  })
})

describe('changing several people at once', () => {
  it('shows what will change in words, then applies it to everyone chosen and to nobody else', async () => {
    await db.people.bulkAdd([personOf('a', { firstName: 'Анна' }), personOf('b', { firstName: 'Борис' }), personOf('c', { firstName: 'Вера' })])
    const { user } = renderApp('/people')
    await screen.findByText(/Анна/)
    open({ kind: 'bulk', personIds: ['a', 'b'] })
    await screen.findByRole('dialog')
    const apply = await dialog().findByRole('button', { name: t('Fill in at least one field') })
    expect(apply).toBeDisabled()

    await user.type(dialog().getAllByPlaceholderText(t("Don't change"))[0]!, 'Лиссабон')
    await user.type(dialog().getByPlaceholderText(t('investor, dubai')), 'инвестор, друг')
    expect(await dialog().findByText(/Лиссабон/, { selector: 'div' })).toBeInTheDocument()
    await user.click(dialog().getByRole('button', { name: t('Apply to {count}', { count: 2 }) }))

    await waitFor(async () => expect((await db.people.get('a'))?.city).toBe('Лиссабон'))
    expect((await db.people.get('b'))?.city).toBe('Лиссабон')
    expect((await db.people.get('a'))?.tags).toEqual(expect.arrayContaining(['инвестор', 'друг']))
    expect((await db.people.get('c'))?.city).toBeFalsy()
  })
})

describe('duplicates', () => {
  it('finds the same person under two cards, merges them into one and keeps what both knew', async () => {
    await db.people.bulkAdd([
      personOf('d1', { firstName: 'Алексей', lastName: 'Петров', channels: [{ type: 'email', value: 'alex@example.com' }] }),
      personOf('d2', { firstName: 'Alexey', lastName: 'Petrov', city: 'Берлин' }),
      personOf('x', { firstName: 'Мария' }),
    ])
    const { user } = renderApp('/people')
    await screen.findByText(/Мария/)
    open({ kind: 'dedupe' })
    await screen.findByRole('dialog')
    expect((await dialog().findAllByText(/Алексей|Alexey/)).length).toBeGreaterThan(0)
    await user.click(await dialog().findByRole('button', { name: new RegExp(`^${t('Merge')}`) }))
    await waitFor(async () => expect(await db.people.count()).toBe(2))
    const left = (await db.people.toArray()).find(p => /Алексей|Alexey/.test(p.firstName))!
    expect(left.city).toBe('Берлин') // empty fields are filled from the other card
    expect(left.channels).toEqual([{ type: 'email', value: 'alex@example.com' }])
  })

  it('says so when there are none', async () => {
    await db.people.bulkAdd([personOf('a', { firstName: 'Анна' }), personOf('b', { firstName: 'Борис' })])
    renderApp('/people')
    await screen.findByText(/Анна/)
    open({ kind: 'dedupe' })
    expect(await dialog().findByText(t('No duplicates'))).toBeInTheDocument()
  })
})

describe('preferences, dates and family', () => {
  it('saves hobbies and allergies for a person', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга' }))
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open({ kind: 'prefs', personId: 'p1' })
    await screen.findByRole('dialog')
    const hobby = await dialog().findByPlaceholderText(t('Add a hobby and press Enter'))
    await user.type(hobby, 'керамика{Enter}')
    await user.type(dialog().getByPlaceholderText(t("Gluten, nuts, doesn't eat meat")), 'орехи')
    await user.click(dialog().getByRole('button', { name: t('Save') }))
    await waitFor(async () => expect((await db.people.get('p1'))?.prefs?.hobbies).toContain('керамика'))
    expect((await db.people.get('p1'))?.prefs?.allergies ?? '').toContain('орехи')
  })

  it('adds a member of the family as a separate person linked to the owner', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга' }))
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open({ kind: 'family', ownerId: 'p1' })
    await screen.findByRole('dialog')
    await user.type(dialog().getByPlaceholderText(t('Eve')), 'Маша')
    await user.click(dialog().getByRole('button', { name: t('Add') }))
    await waitFor(async () => expect((await db.people.toArray()).some(p => p.familyOf === 'p1' && p.firstName === 'Маша')).toBe(true))
  })
})
