import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUI } from '@/app/store'
import { db } from '@/data/db'
import { createCollection } from '@/data/collections'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { renderApp, seed } from './harness'

const NOW = Date.now()
const DAY = 86_400_000

beforeEach(async () => {
  await seed({ demo: false })
  await db.people.bulkAdd([
    personOf('a', { firstName: 'Анна', lastName: 'Орлова', company: 'Студия', closeness: 1, lastContactAt: NOW - 2 * DAY, pinned: true }),
    personOf('b', { firstName: 'Борис', lastName: 'Власов', closeness: 3, lastContactAt: NOW - 90 * DAY }),
    personOf('c', { firstName: 'Вера', lastName: 'Громова', closeness: 2, lastContactAt: NOW - 10 * DAY }),
  ])
})

describe('the people screen', () => {
  it('lists everyone, and narrows by what is typed (name, company)', async () => {
    const { user } = renderApp('/people')
    expect(await screen.findByText(/Борис Власов/)).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(t('Name, company, interest…')), 'студия')
    await waitFor(() => expect(screen.queryByText(/Борис Власов/)).toBeNull())
    expect(screen.getAllByText(/Анна Орлова/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: t('Clear') }))
    expect(await screen.findByText(/Борис Власов/)).toBeInTheDocument()
  })

  it('says so when nobody matches', async () => {
    const { user } = renderApp('/people')
    await screen.findByText(/Борис Власов/)
    await user.type(screen.getByPlaceholderText(t('Name, company, interest…')), 'цццццц')
    expect(await screen.findByText(new RegExp(t('No one found')))).toBeInTheDocument()
  })

  it('the sort button cycles the order, and favorites can be shown alone', async () => {
    const { user } = renderApp('/people')
    await screen.findByText(/Борис Власов/)
    await user.click(screen.getByRole('button', { name: t('By name') }))
    await user.click(await screen.findByRole('button', { name: t('Longest since contact') }).catch(() => screen.getByRole('button', { name: new RegExp(t('Longest since contact')) })))
    await user.click(screen.getByRole('button', { name: new RegExp(t('Favorites')) }))
    await waitFor(() => expect(screen.queryByText(/Борис Власов/)).toBeNull())
    expect(screen.getAllByText(/Анна/).length).toBeGreaterThan(0)
  })

  it('selecting several: a count, "select all", and the two actions that take the choice on', async () => {
    const { user } = renderApp('/people')
    await screen.findByText(/Борис Власов/)
    await user.click(screen.getByRole('button', { name: t('Select several') }))
    expect(await screen.findByText(t('Select people for an action'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: new RegExp('^' + t('All · {count}', { count: '' }).split(' ·')[0]!) }))
    await waitFor(() => expect(screen.getByText(t('{count} selected', { count: 3 }))).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: t('Deselect all') }))
    await waitFor(() => expect(screen.queryByText(t('{count} selected', { count: 3 }))).toBeNull())
    await user.click(screen.getByRole('button', { name: new RegExp('^' + t('All · {count}', { count: '' }).split(' ·')[0]!) }))
    const bar = screen.getByText(t('{count} selected', { count: 3 })).parentElement!
    await user.click(within(bar).getAllByRole('button')[0]!)
    expect(useUI.getState().sheet).toMatchObject({ kind: 'collectionPick' })
    useUI.getState().close()
    await user.click(within(bar).getAllByRole('button')[1]!)
    expect(useUI.getState().sheet).toMatchObject({ kind: 'bulk' })
    expect((useUI.getState().sheet as { personIds: string[] }).personIds.sort()).toEqual(['a', 'b', 'c'])
    useUI.getState().close()
    await user.click(screen.getAllByRole('button', { name: t('Finish selecting') })[0]!)
    await waitFor(() => expect(screen.queryByText(t('Select people for an action'))).toBeNull())
  })

  it('a list shows only its people, and its names can be copied', async () => {
    await createCollection({ name: 'К ужину', emoji: '🍽️', palette: 'aurora', note: '', personIds: ['a', 'c'], leadIds: [] })
    const { user } = renderApp('/people')
    await screen.findByText(/Борис Власов/)
    await user.click(await screen.findByRole('button', { name: /К ужину/ }))
    await waitFor(() => expect(screen.queryByText(/Борис Власов/)).toBeNull())
    await user.click(screen.getByRole('button', { name: t('Copy names') }))
    await waitFor(async () => expect((await navigator.clipboard.readText()).split('\n').sort()).toEqual(['Анна Орлова', 'Вера Громова']))
  })

  it('with nobody yet, invites to add the first person', async () => {
    await db.people.clear()
    renderApp('/people')
    expect(await screen.findByText(t('People will appear here'))).toBeInTheDocument()
  })

  it('the header actions open the deck, and a new person', async () => {
    const { user } = renderApp('/people')
    await screen.findByText(/Борис Власов/)
    await user.click(screen.getByRole('button', { name: t('New person') }))
    expect(useUI.getState().sheet).toEqual({ kind: 'addPerson' })
    useUI.getState().close()
    await user.click(screen.getByRole('button', { name: t('Go through the deck') }))
    await waitFor(() => expect(window.location.hash).toBe('#/review'))
  })
})
