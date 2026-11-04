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
  await db.people.bulkAdd([
    personOf('anna', { firstName: 'Анна', lastName: 'Орлова', company: 'Студия', role: 'Дизайнер', lastContactAt: NOW - 2 * DAY }),
    personOf('boris', { firstName: 'Борис', lastName: 'Власов', role: 'Инвестор', city: 'Лиссабон', lastContactAt: NOW - 40 * DAY }),
  ])
  await db.interactions.add({ id: 'i1', type: 'meeting', personIds: ['anna'], date: NOW - 3 * DAY, title: 'Кофе у реки', note: 'обсудили выставку', place: 'Лиссабон' } as never)
})

const open = async () => {
  const ctx = renderApp('/')
  await screen.findByText(/Анна/)
  await ctx.user.click(screen.getByRole('button', { name: t('Search') }))
  const input = await screen.findByPlaceholderText(t('Find a person or ask the network…'))
  const box = input.closest('.glass-strong') as HTMLElement
  return { ...ctx, input, box }
}

describe('the search overlay', () => {
  it('with nothing typed: recent people, example questions and the quick actions', async () => {
    const { box } = await open()
    expect(await within(box).findByText(t('Ask your network'))).toBeInTheDocument()
    expect(within(box).getByText(t('People'))).toBeInTheDocument()
    expect(within(box).getByText(t('Actions'))).toBeInTheDocument()
    expect(within(box).getByRole('button', { name: t('Network pulse') })).toBeInTheDocument()
  })

  it('arrow keys move the highlight and Enter opens that person', async () => {
    const { user, input } = await open()
    await user.type(input, 'о')
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowDown}{Enter}')
    await waitFor(() => expect(window.location.hash).toMatch(/#\/person\//))
    await waitFor(() => expect(useUI.getState().search).toBe(false))
  })

  it('a quick action runs and closes the search (a sheet opens, or a screen)', async () => {
    const { user, input } = await open()
    await user.type(input, t('Reminder').slice(0, 5))
    await user.click(await screen.findByRole('button', { name: t('Reminder') }))
    expect(useUI.getState().sheet).toMatchObject({ kind: 'reminder' })
    expect(useUI.getState().search).toBe(false)
  })

  it('an action that is a screen goes there', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: t('Network pulse') }))
    await waitFor(() => expect(window.location.hash).toBe('#/pulse'))
  })

  it('a record is found by its title, place or note, and opens its person', async () => {
    const { user, input, box } = await open()
    await user.type(input, 'выставку')
    expect(await within(box).findByText(t('Records'))).toBeInTheDocument()
    await user.click(await within(box).findByText('Кофе у реки'))
    await waitFor(() => expect(window.location.hash).toBe('#/person/anna'))
  })

  it('nothing matches: no people, but the question row is still offered', async () => {
    const { user, input, box } = await open()
    await user.type(input, 'зюзябрик')
    expect(await within(box).findByText(t('Ask the network'))).toBeInTheDocument()
    expect(within(box).queryByText(t('People'))).toBeNull()
  })

  it('an example question is asked: an answer, the people it names, "continue in the chat", and a way back', async () => {
    const { user } = await open()
    const chip = (await screen.findAllByRole('button')).find(b => b.textContent === t('Whose birthdays are coming up?'))!
    await user.click(chip)
    expect(await screen.findByText(t('Answer'), undefined, { timeout: 8000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('Back') }))
    expect(await screen.findByPlaceholderText(t('Find a person or ask the network…'))).toBeInTheDocument()
  })

  it('a typed question with Enter asks the network, and the question can be continued in the chat', async () => {
    const { user, input } = await open()
    await user.type(input, 'Кто из инвесторов давно не писал?{Enter}')
    expect(await screen.findByText(t('Answer'), undefined, { timeout: 8000 })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: new RegExp(t('Continue in chat')) }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat/))
    expect(useUI.getState().search).toBe(false)
  })

  it('Esc leaves the answer first, and a second Esc closes the search', async () => {
    const { user, input } = await open()
    await user.type(input, 'Кто из инвесторов давно не писал?{Enter}')
    await screen.findByText(t('Answer'), undefined, { timeout: 8000 })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText(t('Answer'))).toBeNull())
    expect(useUI.getState().search).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(useUI.getState().search).toBe(false))
  })

  it('"Cancel" closes the search', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: t('Cancel') }))
    await waitFor(() => expect(useUI.getState().search).toBe(false))
  })
})
