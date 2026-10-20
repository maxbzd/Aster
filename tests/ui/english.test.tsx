import { screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { setLocale } from '@/i18n'
import { renderApp, seed, watchConsole } from './harness'

// The suite runs in Russian; these tests check the English interface and the language switch.
beforeAll(() => setLocale('en'))
afterAll(() => {
  setLocale('ru')
  try { localStorage.removeItem('aster.locale') } catch { /* ignore */ }
})

describe('English interface', () => {
  it('the demo network and the home screen read naturally in English', async () => {
    await seed({ demo: true })
    const bad = watchConsole()
    renderApp('/')
    expect(await screen.findByText(/Good (morning|afternoon|evening|night)/)).toBeInTheDocument()
    expect(await screen.findByText(/network pulse/i)).toBeInTheDocument()
    expect(await screen.findByText('waiting for contact')).toBeInTheDocument()
    const alice = await db.people.filter(p => p.firstName === 'Alice').first()
    expect(alice?.company).toBe('Lumen Labs')
    expect((await db.circles.toArray()).map(c => c.name)).toContain('Friends')
    expect(await db.leads.count()).toBe(23)
    expect(bad).toEqual([])
  })

  it('the navigation and the profile are in English, and the language can be switched', async () => {
    await seed({ demo: true })
    const { user } = renderApp('/me')
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    const nav = (await screen.findAllByRole('navigation'))[0]!
    for (const label of ['Today', 'People', 'Orbit', 'Me']) expect(within(nav).getByText(label)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Русский' }))
    expect(await screen.findByRole('heading', { name: 'Профиль' })).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem('aster.locale')).toBe('ru'))

    await user.click(await screen.findByRole('button', { name: 'English' }))
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
  })
})
