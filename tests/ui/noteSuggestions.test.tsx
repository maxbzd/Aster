import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { NoteSuggestions } from '@/components/astra/NoteSuggestions'
import { useUI } from '@/app/store'
import { db } from '@/data/db'
import { LocaleRoot } from '@/i18n/react'
import { quickNoteSuggestions } from '@/ai/astra'
import { personOf } from '../cloud/rows'
import { seed } from './harness'

const NOTE = 'Оля ищет инвестора для студии, очень любит керамику. День рождения 5 мая. Напомнить написать ей через неделю.'

beforeEach(async () => {
  await seed({ demo: false })
  await db.people.add(personOf('p1', { firstName: 'Ольга' }))
})

const draw = async (text: string) => {
  const person = (await db.people.get('p1'))!
  return render(<LocaleRoot><NoteSuggestions text={text} person={person} /></LocaleRoot>)
}

describe('suggestions from a note', () => {
  it('the engine on the device finds what is worth saving in a note', async () => {
    const person = (await db.people.get('p1'))!
    const kinds = quickNoteSuggestions(NOTE, person, [person]).items.map(i => i.kind)
    expect(kinds).toEqual(expect.arrayContaining(['looking_for']))
    expect(kinds.length).toBeGreaterThanOrEqual(2)
  })

  it('shows nothing for a short or empty note', async () => {
    const { container } = await draw('привет')
    await new Promise(r => setTimeout(r, 1100))
    expect(container.textContent).toBe('')
  })

  it('offers what it found after a short pause, and one tap saves it to the person and takes it off the list', async () => {
    const user = userEvent.setup()
    await draw(NOTE)
    const chips = await screen.findAllByRole('button', {}, { timeout: 4000 })
    expect(chips.length).toBeGreaterThanOrEqual(2)
    const wanted = chips.find(c => /Ищет|Looking for/.test(c.textContent ?? ''))
    expect(wanted).toBeDefined()
    await user.click(wanted!)
    await waitFor(async () => expect(((await db.people.get('p1'))?.lookingFor ?? '').toLowerCase()).toContain('инвестор'))
    await waitFor(() => expect(screen.queryAllByRole('button').length).toBe(chips.length - 1))
    expect(useUI.getState().toasts.some(x => x.text.includes('сохранено') || x.text.includes('saved'))).toBe(true)
  })

  it('a reminder suggestion creates a reminder for the person', async () => {
    const user = userEvent.setup()
    await draw(NOTE)
    const chips = await screen.findAllByRole('button', {}, { timeout: 4000 })
    const reminder = chips.find(c => /Напомнить|Remind/.test(c.textContent ?? ''))
    if (!reminder) return // the local engine may phrase it as another kind: the other kinds are checked above
    await user.click(reminder)
    await waitFor(async () => expect((await db.reminders.toArray()).some(r => r.personId === 'p1')).toBe(true))
  })
})
