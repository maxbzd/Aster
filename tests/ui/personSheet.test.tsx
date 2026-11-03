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

describe('adding a person', () => {
  it('cannot be saved without a first name', async () => {
    renderApp('/people')
    open({ kind: 'addPerson' })
    await screen.findByRole('dialog')
    expect(dialog().getByRole('button', { name: t('Add to network') })).toBeDisabled()
    expect(dialog().getByRole('button', { name: t('Add another') })).toBeDisabled()
  })

  it('saves what was filled in: the name, the work, a contact, a city and interests, and drops an empty contact', async () => {
    const { user } = renderApp('/people')
    open({ kind: 'addPerson' })
    await screen.findByRole('dialog')
    await user.type(await dialog().findByPlaceholderText(t('First name')), '  Ольга ')
    await user.type(dialog().getByPlaceholderText(t('Last name')), 'Смирнова')
    await user.type(dialog().getByPlaceholderText(t('Founder, designer, investor…')), 'Дизайнер')
    await user.type(dialog().getByPlaceholderText(t('Where they work')), 'Студия')
    await user.type(dialog().getByPlaceholderText(t("Web Summit, dinner at friends', Telegram…")), 'Лиссабон-митап')

    // two contacts: one filled in, one left empty
    await user.click(dialog().getAllByRole('button', { name: /Telegram/i })[0]!)
    await user.keyboard('@olga') // a new contact takes the focus
    await user.click(dialog().getAllByRole('button', { name: /e-?mail|почта/i })[0]!) // left empty on purpose

    await user.click(dialog().getByRole('button', { name: new RegExp(t('City')) }))
    await user.type(await dialog().findByPlaceholderText(t('London, Dubai, Lisbon…')), 'Лиссабон')
    await user.click(dialog().getByRole('button', { name: new RegExp(t('Interests')) }))
    const tags = await dialog().findByPlaceholderText(t('AI, running, wine… Enter'))
    await user.type(tags, 'керамика{Enter}')
    await user.type(tags, 'бег,')

    await user.click(dialog().getByRole('button', { name: t('Add to network') }))
    await waitFor(async () => expect(await db.people.count()).toBe(1))
    const person = (await db.people.toArray())[0]!
    expect(person).toMatchObject({ firstName: 'Ольга', lastName: 'Смирнова', role: 'Дизайнер', company: 'Студия', metPlace: 'Лиссабон-митап', city: 'Лиссабон' })
    expect(person.tags).toEqual(['керамика', 'бег'])
    expect(person.channels.map(c => c.value)).toEqual(['@olga']) // the empty email was not saved
    await waitFor(() => expect(window.location.hash).toBe(`#/person/${person.id}`)) // and the new person's card opens
  })

  it('"Add another" saves this one and starts the next with the same place, date and circles', async () => {
    const { user } = renderApp('/people')
    open({ kind: 'addPerson' })
    await screen.findByRole('dialog')
    await user.type(await dialog().findByPlaceholderText(t('First name')), 'Анна')
    await user.type(dialog().getByPlaceholderText(t("Web Summit, dinner at friends', Telegram…")), 'Конференция')
    await user.click(dialog().getByRole('button', { name: t('Add another') }))
    await waitFor(async () => expect(await db.people.count()).toBe(1))
    expect((dialog().getByPlaceholderText(t('First name')) as HTMLInputElement).value).toBe('') // a fresh form
    expect((dialog().getByPlaceholderText(t("Web Summit, dinner at friends', Telegram…")) as HTMLInputElement).value).toBe('Конференция') // the place is kept
    await user.type(dialog().getByPlaceholderText(t('First name')), 'Борис')
    await user.click(dialog().getByRole('button', { name: t('Add to network') }))
    await waitFor(async () => expect(await db.people.count()).toBe(2))
    expect((await db.people.toArray()).every(p => p.metPlace === 'Конференция')).toBe(true)
  })
})

describe('editing a person', () => {
  it('opens with what is known, opens the sections that already have something, and saves a change', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга', city: 'Берлин', tags: ['чай'], nickname: 'Оля', notes: 'любит джаз' }))
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open({ kind: 'editPerson', id: 'p1' })
    expect(await dialog().findByDisplayValue('Ольга')).toBeInTheDocument()
    expect(dialog().getByDisplayValue('Берлин')).toBeInTheDocument()
    expect(dialog().getByDisplayValue('Оля')).toBeInTheDocument()
    expect(dialog().getByText('чай')).toBeInTheDocument()
    expect(dialog().getByDisplayValue('любит джаз')).toBeInTheDocument()

    await user.clear(dialog().getByDisplayValue('Берлин'))
    await user.type(dialog().getByPlaceholderText(t('London, Dubai, Lisbon…')), 'Вена')
    await user.click(dialog().getByText('чай')) // an interest is removed by tapping it
    await user.click(dialog().getByRole('button', { name: t('Save') }))
    await waitFor(async () => expect((await db.people.get('p1'))?.city).toBe('Вена'))
    expect((await db.people.get('p1'))?.tags).toEqual([])
    expect((await db.people.get('p1'))?.notes).toBe('любит джаз')
  })
})

describe('important dates', () => {
  const withDate = async () => db.people.add(personOf('p1', {
    firstName: 'Ольга',
    importantDates: [{ id: 'd1', kind: 'anniversary', label: 'Годовщина свадьбы', date: '2018-06-02', yearly: true, remindDays: 7 }],
  }))

  it('cannot be saved without a date', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга' }))
    renderApp('/people')
    open({ kind: 'dateEdit', personId: 'p1' })
    await screen.findByRole('dialog')
    expect(await dialog().findByText(t('New important date'))).toBeInTheDocument()
    expect(dialog().getByRole('button', { name: t('Save') })).toBeDisabled()
    expect(await dialog().findByText(t('For {name}', { name: 'Ольга' }))).toBeInTheDocument()
  })

  it('opens an existing date with everything it had, changes its title and reminder, and keeps the date itself', async () => {
    await withDate()
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open({ kind: 'dateEdit', personId: 'p1', id: 'd1' })
    await screen.findByRole('dialog')
    const title = await dialog().findByDisplayValue('Годовщина свадьбы')
    await user.clear(title)
    await user.type(title, 'Серебряная свадьба')
    await user.click(dialog().getByText(t('3 days before')))
    await user.click(dialog().getByRole('button', { name: t('Save') }))
    await waitFor(async () => expect((await db.people.get('p1'))?.importantDates?.[0]?.label).toBe('Серебряная свадьба'))
    const saved = (await db.people.get('p1'))!.importantDates!
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ id: 'd1', date: '2018-06-02', remindDays: 3, yearly: true })
  })

  it('a date can be deleted, and the person keeps everything else', async () => {
    await withDate()
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open({ kind: 'dateEdit', personId: 'p1', id: 'd1' })
    await screen.findByRole('dialog')
    await user.click(await dialog().findByRole('button', { name: t('Delete date') }))
    await waitFor(async () => expect((await db.people.get('p1'))?.importantDates).toEqual([]))
    expect((await db.people.get('p1'))?.firstName).toBe('Ольга')
  })
})
