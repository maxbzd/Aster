import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localCapture, localNoteSuggest } from '@/ai/local/parse'
import { setLocale } from '@/i18n'
import { NOW, person } from '../helpers'

beforeEach(() => setLocale('en'))
afterEach(() => setLocale('ru'))

const iso = (days: number) => {
  const d = new Date(NOW + days * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('capturing a meeting in English', () => {
  it('extracts a new person with role, industry, request, birthday and an agreement', () => {
    const plan = localCapture(
      "Met Artem Belov at dinner at Alina's — he's a CTO in fintech, moving to Dubai in March. He is looking for an investor. His birthday is May 14. We agreed to call on Friday.",
      [], NOW,
    )
    const d = plan.people[0]!
    expect(d.first_name).toBe('Artem')
    expect(d.last_name).toBe('Belov')
    expect(d.role).toBe('CTO')
    expect(d.interests).toContain('Fintech')
    expect(d.looking_for).toBe('Investor')
    expect(d.birthday).toBe('--05-14')
    expect(d.topics).toContain('How the move to Dubai is going')
    expect(plan.reminders.map(r => r.text)).toContain('Call Artem')
    expect(plan.reminders.find(r => r.text === 'Call Artem')?.due_date).toBe(iso(4)) // NOW is Monday → Friday
    expect(plan.interaction?.place).toBe("Dinner at Alina's")
    expect(plan.summary).toBe('New acquaintance: Artem · 1 reminder')
  })

  it('recognises people from the network, skipping the one who introduced', () => {
    const olivia = person({ id: 'o', firstName: 'Olivia', lastName: 'Grant' })
    const sam = person({ id: 's', firstName: 'Sam' })
    const plan = localCapture('Coffee with Olivia. She works at Spotify as a designer, lives in Berlin. Introduced by Sam.', [olivia, sam], NOW)
    const d = plan.people[0]!
    expect(d.existing_id).toBe('o')
    expect(d.company).toBe('Spotify')
    expect(d.role).toBe('Designer')
    expect(d.city).toBe('Berlin')
    expect(d.introduced_by_id).toBe('s')
    expect(plan.interaction?.type).toBe('meeting')
    expect(plan.summary).toBe('Meeting: Olivia')
  })

  it('collects family, hobbies and diet', () => {
    const plan = localCapture("Met Katie Smith at a conference. Katie's wife Maria, son Leo (5 years old). She loves running and doesn't drink coffee.", [], NOW)
    const d = plan.people[0]!
    expect(d.first_name).toBe('Katie')
    expect(d.family).toBe('Wife Maria, son Leo (5 years)')
    expect(d.facts).toContain('Loves running')
    expect(d.interests).toContain('Running')
    expect(plan.interaction?.type).toBe('event')
  })

  it('a note that starts with a name', () => {
    const plan = localCapture('Katie Smith, designer at Spotify, lives in Berlin', [], NOW)
    expect(plan.people[0]).toMatchObject({ first_name: 'Katie', last_name: 'Smith', role: 'Designer', company: 'Spotify', city: 'Berlin' })
  })

  it('does not take a sentence starter for a name', () => {
    expect(localCapture('Today was a good day', [], NOW).people).toHaveLength(0)
    expect(localCapture('Today was a good day', [], NOW).summary).toMatch(/Couldn't find a name/)
  })

  it('output follows the interface language, even for English input', () => {
    setLocale('ru')
    const plan = localCapture('Met Artem at dinner. He is a designer in Berlin. Agreed to call on Friday.', [], NOW)
    expect(plan.people[0]).toMatchObject({ first_name: 'Artem', role: 'Дизайнер', city: 'Берлин' })
    expect(plan.reminders[0]!.text).toBe('Позвонить Artem')
    expect(plan.summary).toBe('Новое знакомство: Artem · 1 напоминание')
  })
})

describe('suggestions for a note about a known person', () => {
  it('offers reminders, facts and requests', () => {
    const p = person({ id: 'x', firstName: 'Oliver' })
    const { items } = localNoteSuggest('Looking for a CTO. Promised to send the deck tomorrow. Birthday on 3 March. Allergic to nuts.', p, [], NOW)
    const kinds = items.map(i => i.kind)
    expect(kinds).toEqual(expect.arrayContaining(['looking_for', 'reminder', 'birthday', 'fact']))
    expect(items.find(i => i.kind === 'looking_for')!.text).toBe('CTO')
    expect(items.find(i => i.kind === 'reminder')!).toMatchObject({ text: 'Send the deck tomorrow', due_date: iso(1) })
    expect(items.find(i => i.kind === 'birthday')!).toMatchObject({ text: 'Birthday', due_date: '--03-03' })
  })
})
