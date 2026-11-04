import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '@/app/store'
import type { CapturePlan } from '@/ai/schemas'
import { PlanReview, type PlanExtras } from '@/components/astra/PlanReview'
import { db } from '@/data/db'
import { saveSettings } from '@/data/actions'
import { LocaleRoot } from '@/i18n/react'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { renderApp, seed } from './harness'

const io = vi.hoisted(() => ({ file: null as File | null, transcript: 'x' as string | Error, progress: false }))
vi.mock('@/lib/image', async original => ({
  ...(await original<typeof import('@/lib/image')>()),
  pickFile: async () => io.file,
  fileToPhoto: async () => 'data:image/jpeg;base64,AAAA',
}))
vi.mock('@/stt/client', async original => ({
  ...(await original<typeof import('@/stt/client')>()),
  networkTerms: async () => ['Нина'],
  transcribeFile: async (_f: File, _s: unknown, onProgress?: (p: { done: number; total: number }) => void, signal?: AbortSignal) => {
    onProgress?.({ done: 1, total: 3 })
    if (io.progress) await new Promise((_r, rej) => signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    if (io.transcript instanceof Error) throw io.transcript
    return io.transcript
  },
}))

beforeEach(async () => {
  io.file = null; io.transcript = 'x'; io.progress = false
  await seed({ demo: false })
  useUI.setState({ sheet: null, toasts: [] })
})
const toasts = () => useUI.getState().toasts.map(x => x.text)
const textArea = async () => (await screen.findByRole('textbox')) as HTMLTextAreaElement

describe('dictating a meeting: from text to saved cards', () => {
  it('typed note → review → edit a detail → save all: the person, the entry and the reminder are in the database, and their page opens', async () => {
    const { user } = renderApp('/capture?mode=text')
    await user.click(await textArea())
    await user.paste('Познакомился с Артёмом Беловым на ужине — он CTO в финтехе из Дубая. Надо написать ему в пятницу.')
    await user.click(await screen.findByRole('button', { name: /Разобрать/ }))
    expect(await screen.findByText(/Вот что я поняла/i)).toBeInTheDocument()
    const first = screen.getByPlaceholderText(t('First name')) as HTMLInputElement
    await user.clear(first)
    await user.type(first, 'Артём')
    await user.click(screen.getByRole('button', { name: t('Save all') }))
    await waitFor(async () => expect(await db.people.filter(p => p.lastName === 'Белов').count()).toBe(1))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/person\//))
    expect(toasts().some(x => x.startsWith(t('Saved: {v}', { v: '' }).slice(0, 8)))).toBe(true)
  })

  it('"Close" on the review goes back to the note; on the note it leaves the screen', async () => {
    const { user } = renderApp('/capture?mode=text')
    await user.click(await textArea())
    await user.paste('Познакомился с Артёмом Беловым на ужине — он CTO в финтехе.')
    await user.click(await screen.findByRole('button', { name: /Разобрать/ }))
    await screen.findByText(/Вот что я поняла/i)
    await user.click(screen.getByRole('button', { name: t('Close') }))
    expect((await textArea()).value).toContain('Артёмом')
  })

  it('a note with nobody in it says so and cannot be saved', async () => {
    const { user } = renderApp('/capture?mode=text')
    await user.click(await textArea())
    await user.paste('сегодня была хорошая погода и всё')
    await user.click(await screen.findByRole('button', { name: /Разобрать/ }))
    expect(await screen.findByText(t("Couldn't tell who this is about"))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('Save all') })).toBeDisabled()
  })

  it('a photo is added and removed; the hint says a model is needed to read it', async () => {
    io.file = new File([new Uint8Array(4)], 'card.jpg', { type: 'image/jpeg' })
    const { user } = renderApp('/capture?mode=text')
    await textArea()
    await user.click(await screen.findByRole('button', { name: t('Photo of a business card or badge') }))
    expect(await screen.findByText(t('Astra will read business-card photos once you connect a model'))).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: t('Remove photo') }))
    await waitFor(() => expect(screen.queryByRole('button', { name: t('Remove photo') })).toBeNull())
  })
})

describe('transcribing a recording', () => {
  beforeEach(async () => {
    await saveSettings({ stt: { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' } as never })
    io.file = new File([new Uint8Array(10)], 'встреча.m4a', { type: 'audio/mp4' })
  })
  const start = async () => {
    const ctx = renderApp('/capture?mode=text')
    await textArea()
    await ctx.user.click(await screen.findByRole('button', { name: t('Upload a meeting recording') }))
    return ctx
  }

  it('the text lands in the note and the screen says so', async () => {
    io.transcript = 'Встретились с Ниной, договорились о кофе'
    await start()
    await waitFor(() => expect(toasts()).toContain(t('Recording transcribed')))
    expect((await textArea()).value).toContain('Ниной')
  })

  it('a recording with no speech in it', async () => {
    io.transcript = ''
    await start()
    await waitFor(() => expect(toasts()).toContain(t("Couldn't make out any speech in the recording")))
  })

  it('a server error is shown as it is', async () => {
    io.transcript = new Error('Сервер недоступен')
    await start()
    await waitFor(() => expect(toasts()).toContain('Сервер недоступен'))
  })

  it('the progress is shown, and "Cancel" stops it without an error message', async () => {
    io.progress = true
    const { user } = await start()
    expect(await screen.findByText(t('Transcribing the recording'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('Cancel') }))
    await waitFor(() => expect(screen.queryByText(t('Transcribing the recording'))).toBeNull())
    expect(toasts()).not.toContain('aborted')
  })
})

/* ---------- the review card on its own ---------- */

const plan = (): CapturePlan => ({
  summary: 'Встреча',
  people: [{
    ref: 'p1', existing_id: null, first_name: 'Артём', last_name: 'Белов', role: 'CTO', company: 'Acme', city: 'Дубай', family: null, facts: ['Любит бег'], interests: ['AI'],
    looking_for: 'Инвестор', can_help: 'Rust', i_can_help: null, channels: [{ type: 'telegram', value: 'artem' }], birthday: null, met_place: 'Ужин', introduced_by_id: 'intro', topics: ['Переезд'], gift_ideas: null,
  }],
  interaction: { type: 'meeting', title: 'Ужин', summary: 'Обсудили', place: null, person_refs: ['p1'] },
  reminders: [{ person_ref: 'p1', text: 'Написать', due_date: '2026-10-09' }],
})

function Host({ initial, seen }: { initial: CapturePlan; seen: { plan: CapturePlan; extras: PlanExtras } }) {
  const [p, setP] = useState(initial)
  const [extras, setExtras] = useState<PlanExtras>({ circleIds: [], closeness: 3 })
  seen.plan = p; seen.extras = extras
  return <PlanReview plan={p} onChange={setP} source="local" extras={extras} onExtras={setExtras} />
}

describe('the review card', () => {
  let seen: { plan: CapturePlan; extras: PlanExtras }
  const draw = async (initial = plan()) => {
    await db.people.bulkAdd([personOf('intro', { firstName: 'Алина', lastName: 'Свет' })])
    await db.circles.add({ id: 'c1', name: 'Друзья', emoji: '🙂', palette: 'aurora', order: 0 } as never)
    seen = { plan: initial, extras: { circleIds: [], closeness: 3 } }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<LocaleRoot><MemoryRouter><Host initial={initial} seen={seen} /></MemoryRouter></LocaleRoot>)
    await screen.findByText(t("Here's what I understood"))
    return user
  }

  it('every detail can be edited', async () => {
    const user = await draw()
    await user.type(screen.getByDisplayValue('Дубай'), '!')
    expect(seen.plan.people[0]!.city).toBe('Дубай!')
    // emptying a field takes it off the card
    await user.clear(screen.getByDisplayValue('Acme'))
    expect(seen.plan.people[0]!.company).toBe('')
    await waitFor(() => expect(screen.queryByText(t('Company'))).toBeNull())
    const last = screen.getByPlaceholderText(t('Last name'))
    await user.clear(last)
    expect(seen.plan.people[0]!.last_name).toBeNull()
    const title = screen.getAllByDisplayValue('Ужин').find(e => e.className.includes('mt-1'))!
    await user.type(title, '!')
    expect(seen.plan.interaction!.title).toBe('Ужин!')
    await user.type(screen.getByDisplayValue('Обсудили'), '…')
    expect(seen.plan.interaction!.summary).toBe('Обсудили…')
    await user.type(screen.getByDisplayValue('Написать'), ' Артёму')
    expect(seen.plan.reminders[0]!.text).toBe('Написать Артёму')
  })

  it('details can be removed one by one: a field, a contact, a list item, the reminder, the entry', async () => {
    const user = await draw()
    // "Introduced by" is shown for a person who exists, and can be taken off
    expect(screen.getByText(t('Introduced by'))).toBeInTheDocument()
    const rows = within(screen.getByText(t('Role')).closest('div')!.parentElement!)
    expect(rows.getByDisplayValue('CTO')).toBeInTheDocument()
    const details = (p: CapturePlan) => p.people[0]!.channels.length + p.people[0]!.facts.length + p.people[0]!.interests.length + p.people[0]!.topics.length + p.reminders.length
    // each "Remove" takes off exactly one thing: first the plain fields (role…), then a contact, list items, the reminder
    let n = screen.getAllByRole('button', { name: t('Remove') }).length
    while (n > 0) {
      await user.click(screen.getAllByRole('button', { name: t('Remove') })[n - 1]!)
      const left = screen.queryAllByRole('button', { name: t('Remove') }).length
      expect(left).toBe(n - 1)
      n = left
    }
    expect(details(seen.plan)).toBe(0)
    expect(seen.plan.people[0]!.role).toBe('CTO') // the plain fields have their own remove buttons
    await user.click(screen.getByRole('button', { name: t("Don't log") }))
    expect(seen.plan.interaction).toBeNull()
  })

  it('removing the person takes their reminders and their place in the entry with them', async () => {
    const user = await draw()
    await user.click(screen.getByRole('button', { name: t('Remove person') }))
    expect(seen.plan.people).toHaveLength(0)
    expect(seen.plan.reminders).toHaveLength(0)
    expect(seen.plan.interaction?.person_refs ?? []).toEqual([])
  })

  it('closeness and circles for new people', async () => {
    const user = await draw()
    const segment = screen.getByText(t('For new people')).nextElementSibling as HTMLElement
    await user.click(within(segment).getAllByRole('button')[0]!)
    expect(seen.extras.closeness).toBe(1)
    await user.click(screen.getByRole('button', { name: /🙂 Друзья/ }))
    expect(seen.extras.circleIds).toEqual(['c1'])
    await user.click(screen.getByRole('button', { name: /🙂 Друзья/ }))
    expect(seen.extras.circleIds).toEqual([])
  })

  it('a known person: the card is updated, not created, and there are no "new people" options', async () => {
    const known = plan()
    known.people[0]!.existing_id = 'intro'
    const user = await draw(known)
    expect(screen.getByText(t("Already in your network — I'll update the card"))).toBeInTheDocument()
    expect(screen.queryByText(t('For new people'))).toBeNull()
    expect(user).toBeTruthy()
  })
})
