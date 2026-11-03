import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { renderApp, seed } from './harness'

describe('the graph of connections', () => {
  it('with no connections, says so and leads to the people', async () => {
    await seed({ demo: false })
    await db.people.bulkAdd([personOf('a', { firstName: 'Анна' }), personOf('b', { firstName: 'Борис' })])
    const { user } = renderApp('/graph')
    expect(await screen.findByText(t('No connections between people yet'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('To people') }))
    await waitFor(() => expect(window.location.hash).toBe('#/people'))
  })

  describe('with people who know each other', () => {
    beforeEach(async () => {
      await seed({ demo: false })
      const link = (...ids: string[]) => ids.map(personId => ({ personId, label: 'знакомы' }))
      await db.people.bulkAdd([
        personOf('a', { firstName: 'Анна', links: link('b', 'c') }),
        personOf('b', { firstName: 'Борис', links: link('a', 'c') }),
        personOf('c', { firstName: 'Вера', links: link('a', 'b', 'd') }),
        personOf('d', { firstName: 'Глеб', links: link('c', 'e') }),
        personOf('e', { firstName: 'Дина', links: link('d', 'f') }),
        personOf('f', { firstName: 'Егор', links: link('e') }),
        personOf('lonely', { firstName: 'Ирина' }),
      ])
    })

    it('draws the graph, lists the groups and the people without connections', async () => {
      renderApp('/graph')
      expect(await screen.findByRole('group', { name: t('Graph of connections between people') })).toBeInTheDocument()
      expect(screen.getByText(t('Groups'))).toBeInTheDocument()
      expect(screen.getByText(t('Without connections:'))).toBeInTheDocument()
    })

    it('every person in the graph is a button: choosing one (by mouse or keyboard) shows who they know and leads to their profile', async () => {
      const { user } = renderApp('/graph')
      const graph = within(await screen.findByRole('group', { name: t('Graph of connections between people') }))
      const node = await graph.findByRole('button', { name: /Вера/, pressed: false })
      await user.click(node)
      expect(await graph.findByRole('button', { name: /Вера/, pressed: true })).toBeInTheDocument()
      expect(await screen.findByText(/Знает|Knows/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: t('Close') }))
      const other = await graph.findByRole('button', { name: /Глеб/, pressed: false })
      other.focus()
      await user.keyboard('{Enter}')
      expect(await graph.findByRole('button', { name: /Глеб/, pressed: true })).toBeInTheDocument()
      await user.click(await screen.findByRole('button', { name: new RegExp(t('Profile')) }))
      await waitFor(() => expect(window.location.hash).toMatch(/^#\/person\//))
    })
  })
})
