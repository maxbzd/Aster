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

describe('the optional sections of a person', () => {
  const edit = async (p = {}) => {
    await db.people.bulkAdd([personOf('p1', { firstName: 'Ольга', ...p }), personOf('p2', { firstName: 'Игорь', lastName: 'Волков' })])
    const ctx = renderApp('/people')
    await screen.findByText(/Ольга/)
    open({ kind: 'editPerson', id: 'p1' })
    await dialog().findByDisplayValue('Ольга')
    return ctx
  }
  // the "Add" block lists the sections that are not open yet (a chip with the same word may also exist in the circles above)
  const add = (label: string) => within(dialog().getByText(t('Add')).parentElement!).getByRole('button', { name: new RegExp(label) })
  const save = async (user: Awaited<ReturnType<typeof edit>>['user']) => { await user.click(dialog().getByRole('button', { name: t('Save') })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()) }

  it('every missing section is offered, and adding one opens it', async () => {
    const { user } = await edit()
    for (const label of ['Birthday', 'City', 'Interests', 'Facts', 'Family', 'Looking for & useful for', 'Meeting story', 'Contact rhythm', 'Links', 'Gift ideas', 'What to call them', 'Note']) {
      await user.click(add(t(label)))
    }
    expect(dialog().queryByText(t('Add'))).toBeNull() // nothing is left to add
  })

  it('birthday: day and month are chosen, the year is optional; clearing the day removes the date', async () => {
    const { user } = await edit()
    await user.click(add(t('Birthday')))
    await user.click(dialog().getByRole('button', { name: t('Birthday: day') }))
    await user.click(await screen.findByRole('option', { name: '14' }))
    await user.click(dialog().getByRole('button', { name: t('Birthday: month') }))
    await user.click((await screen.findAllByRole('option'))[4]!) // May
    await user.type(dialog().getByPlaceholderText(t('unknown')), '1990')
    await save(user)
    expect((await db.people.get('p1'))?.birthday).toBe('1990-05-14')
  })

  it('birthday without a year is kept as "--MM-DD"', async () => {
    const { user } = await edit({ birthday: '1990-05-14' })
    const year = dialog().getByDisplayValue('1990')
    await user.clear(year)
    await save(user)
    expect((await db.people.get('p1'))?.birthday).toBe('--05-14')
  })

  it('facts: add, change the icon, edit and delete', async () => {
    const { user } = await edit({ facts: [{ icon: 'sparkle', text: 'Пьёт фильтр-кофе' }] })
    await user.type(dialog().getByDisplayValue('Пьёт фильтр-кофе'), '!')
    await user.click(dialog().getByTitle(t('Change icon')))
    await user.click(dialog().getByRole('button', { name: t('+ fact') }))
    const empty = dialog().getAllByPlaceholderText(t('Only drinks filter coffee'))
    expect(empty).toHaveLength(2) // the placeholder is on every row; the new row is the last
    await user.type(empty[1]!, 'Бегает по утрам')
    await save(user)
    const p = await db.people.get('p1')
    expect(p?.facts.map(f => f.text)).toEqual(['Пьёт фильтр-кофе!', 'Бегает по утрам'])
    expect(p?.facts[0]?.icon).not.toBe('sparkle')
  })

  it('"looking for", "strong at", "how I can help", the story, the nickname, the gift and the note are saved', async () => {
    const { user } = await edit()
    for (const label of ['Looking for & useful for', 'Meeting story', 'Gift ideas', 'What to call them', 'Family', 'Note']) await user.click(add(t(label)))
    const fill = async (placeholder: string, value: string) => user.type(dialog().getByPlaceholderText(placeholder), value)
    await fill(t('Fintech connections, hiring advice…'), 'Дизайн')
    await fill(t('Got talking in the coffee queue…'), 'В очереди за кофе')
    await fill(t('History books, good tea…'), 'Чай')
    await fill(t('Wife Maria, son Leo (5)'), 'Жена Мария')
    await fill(t("What they're up to, what you talked about…"), 'Важное')
    await save(user)
    const p = await db.people.get('p1')
    expect(p).toMatchObject({ canHelpMe: 'Дизайн', metStory: 'В очереди за кофе', giftIdeas: 'Чай', family: 'Жена Мария', notes: 'Важное' })
  })

  it('contact rhythm: a chosen rhythm is saved, "By orbit" clears it', async () => {
    const { user } = await edit({ cadenceDays: 30 })
    const chips = dialog().getAllByRole('button').filter(b => b.className.includes('rounded-full') && b.closest('div')?.className.includes('flex-wrap'))
    expect(chips.length).toBeGreaterThan(1)
    await user.click(dialog().getByText(t('By orbit')))
    await save(user)
    expect((await db.people.get('p1'))?.cadenceDays).toBeUndefined()
  })

  it('links: the label of a connection can be changed', async () => {
    const { user } = await edit({ links: [{ personId: 'p2', label: 'знакомы' }] })
    const label = await dialog().findByDisplayValue('знакомы')
    await user.clear(label)
    await user.type(label, 'коллеги')
    await save(user)
    expect((await db.people.get('p1'))?.links).toEqual([{ personId: 'p2', label: 'коллеги' }])
  })

  it('links: the connection can be deleted', async () => {
    const { user } = await edit({ links: [{ personId: 'p2', label: 'знакомы' }] })
    await user.click(await dialog().findByRole('button', { name: t('Delete connection') }))
    await save(user)
    expect((await db.people.get('p1'))?.links).toEqual([])
  })
})
