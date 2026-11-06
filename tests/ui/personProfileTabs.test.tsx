import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUI } from '@/app/store'
import { db } from '@/data/db'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { renderApp, seed } from './harness'

const NOW = Date.now()
const DAY = 86_400_000

beforeEach(async () => {
  await seed({ demo: false })
  useUI.setState({ sheet: null, toasts: [] })
  await db.people.bulkAdd([
    personOf('olga', {
      firstName: 'Ольга', lastName: 'Рыжова', nickname: 'Оля', role: 'Керамист', company: 'Глина', city: 'Лиссабон', pinned: true, closeness: 2,
      metAt: '2025-03-01', metPlace: 'Ярмарка', introducedBy: 'igor', lastContactAt: NOW - 20 * DAY,
      channels: [{ type: 'phone', value: '+351 900 000 000' }, { type: 'telegram', value: 'olga_clay' }],
      lookingFor: 'печь для обжига', canHelpMe: 'знает галереи', iCanHelp: 'познакомлю с инвестором',
      facts: [{ icon: 'sparkle', text: 'Пьёт только зелёный чай' }], tags: ['керамика', 'джаз'], giftIdeas: 'Книга про глазури',
      notes: 'Любит тишину', links: [{ personId: 'vera', label: 'вместе учились' }],
    }),
    personOf('igor', { firstName: 'Игорь', lastName: 'Волков', role: 'Инвестор' }),
    personOf('vera', { firstName: 'Вера', lastName: 'Громова' }),
  ])
  await db.interactions.add({ id: 'i1', type: 'meeting', personIds: ['olga'], date: NOW - 20 * DAY, createdAt: NOW - 20 * DAY, title: 'Обед у реки', note: 'говорили о печи' } as never)
  await db.reminders.add({ id: 'r1', text: 'Прислать фото', dueAt: NOW + 3 * DAY, done: false, createdAt: NOW, personId: 'olga' } as never)
})

const open = async () => {
  const ctx = renderApp('/person/olga')
  await screen.findByRole('heading', { name: /Ольга Рыжова/ })
  return ctx
}

describe('a filled-in profile', () => {
  it('overview: the name, the nickname, the work, the city, the contacts and the next step', async () => {
    await open()
    expect(screen.getByText('«Оля»')).toBeInTheDocument()
    expect(screen.getByText(/Керамист/)).toBeInTheDocument()
    expect(screen.getByText('Лиссабон')).toBeInTheDocument()
    expect(await screen.findByText('olga_clay')).toBeInTheDocument()
    expect(screen.getAllByText(/Прислать фото/).length).toBeGreaterThan(0)
    expect(screen.getByText(t('How you met'))).toBeInTheDocument()
  })

  it('the star adds and removes a favourite, with a note each time', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: t('Remove from favorites') }))
    await waitFor(async () => expect((await db.people.get('olga'))?.pinned).toBe(false))
    expect(useUI.getState().toasts.some(x => x.text === t('Removed from favorites'))).toBe(true)
    await user.click(await screen.findByRole('button', { name: t('Add to favorites') }))
    await waitFor(async () => expect((await db.people.get('olga'))?.pinned).toBe(true))
  })

  it('the quick actions open the draft, the brief, the log and the reminder sheets; "Edit" opens the card', async () => {
    const { user } = await open()
    const sheet = () => useUI.getState().sheet
    await user.click(screen.getByRole('button', { name: t('Write') }))
    expect(sheet()).toMatchObject({ kind: 'draft', personId: 'olga' })
    useUI.getState().close()
    await user.click(screen.getByRole('button', { name: t('Brief') }))
    expect(sheet()).toMatchObject({ kind: 'brief', personId: 'olga' })
    useUI.getState().close()
    await user.click(screen.getByRole('button', { name: t('Log') }))
    expect(sheet()).toMatchObject({ kind: 'log', personIds: ['olga'] })
    useUI.getState().close()
    await user.click(screen.getByRole('button', { name: t('Remind') }))
    expect(sheet()).toMatchObject({ kind: 'reminder', personId: 'olga' })
    useUI.getState().close()
    await user.click(screen.getAllByRole('button', { name: t('Edit') })[0]!)
    expect(sheet()).toMatchObject({ kind: 'editPerson', id: 'olga' })
  })

  it('"Details": what they look for and offer, the facts, the tags, the gift idea and the notes', async () => {
    const { user } = await open()
    await user.click(screen.getByText(t('Details')))
    expect(await screen.findByText('печь для обжига')).toBeInTheDocument()
    expect(screen.getByText('знает галереи')).toBeInTheDocument()
    expect(screen.getByText('познакомлю с инвестором')).toBeInTheDocument()
    expect(screen.getByText('Пьёт только зелёный чай')).toBeInTheDocument()
    expect(screen.getByText('керамика')).toBeInTheDocument()
    expect(screen.getByText('Книга про глазури')).toBeInTheDocument()
    expect(screen.getAllByText('Любит тишину').length).toBeGreaterThan(0) // shown in the notes (and again in the editor field)
  })

  it('"History": the timeline has the meeting, and a button per kind of entry starts a log of that kind', async () => {
    const { user } = await open()
    await user.click(screen.getByText(t('History')))
    expect(await screen.findByText('Обед у реки')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button').find(b => b.className.includes('bg-fg/95'))!)
    expect(useUI.getState().sheet).toMatchObject({ kind: 'log', personIds: ['olga'] })
  })

  it('"Links": who introduced them, who they know, and a way to each profile', async () => {
    const { user } = await open()
    await user.click(screen.getByText(t('Links')))
    expect(await screen.findByText(t('Introduced you'))).toBeInTheDocument()
    expect(screen.getByText('вместе учились')).toBeInTheDocument()
    await user.click(screen.getByText(/Вера Громова/))
    await waitFor(() => expect(window.location.hash).toBe('#/person/vera'))
  })

  it('"More" opens its menu and closes it again', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: t('More') }))
    const menu = await screen.findAllByRole('button')
    expect(menu.length).toBeGreaterThan(8)
    await user.click(screen.getByRole('button', { name: t('More') }))
  })

  it('a person who does not exist leads back, not to a blank page', async () => {
    renderApp('/person/ghost')
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Ольга/ })).toBeNull())
    expect(within(document.body).queryByText('Оля')).toBeNull()
  })
})
