import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { yearReview, type YearReview } from '@/data/year'
import { LocaleRoot } from '@/i18n/react'
import { t } from '@/i18n'
import {
  CitiesSlide, IntroSlide, LostSlide, MonthsSlide, NewPeopleSlide, ReciprocitySlide, SummarySlide, TopPersonSlide, TotalSlide, WarmestSlide, type SlideCtx,
} from '@/screens/year/Slides'
import { DAY } from '@/lib/format'
import { NOW, interaction, person } from '../helpers'

const draw = (ui: React.ReactElement) => render(<LocaleRoot><MemoryRouter>{ui}</MemoryRouter></LocaleRoot>)
const ctx = (over: Partial<SlideCtx> = {}): SlideCtx => ({ years: [2026, 2025], setYear: vi.fn(), close: vi.fn(), copy: vi.fn(), copied: false, ...over })

/** A year with people met, places, three kinds of contact, and one friendship that went quiet. */
function richReview(): YearReview {
  const cities = ['Берлин', 'Лиссабон', 'Вена', 'Рим', 'Париж', 'Мадрид', 'Осло']
  const people = Array.from({ length: 24 }, (_, i) => person({
    id: `p${i}`, firstName: `Имя${i}`, lastName: `Фамилия${i}`, city: cities[i % cities.length], closeness: 2,
    createdAt: new Date(2026, i % 9, 3).getTime(), metAt: `2026-0${(i % 9) + 1}-03`,
  }))
  const ints = people.flatMap((p, i) => Array.from({ length: i < 4 ? 8 : 1 }, (_, k) => interaction({
    personIds: [p.id], type: (['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got'] as const)[(i + k) % 6], date: new Date(2026, (i + k) % 9, 2 + k * 4).getTime(),
    initiator: k % 3 === 0 ? 'them' : 'me',
  } as never)))
  // someone you saw regularly in 2025 and not in the last six months
  const quiet = person({ id: 'quiet', firstName: 'Тихон', lastName: 'Молчанов', closeness: 1, createdAt: NOW - 700 * DAY })
  const old = [10, 20, 30].map(m => interaction({ personIds: ['quiet'], type: 'meeting', date: NOW - (400 - m * 3) * DAY }))
  return yearReview(2026, [...people, quiet], [...ints, ...old], NOW)
}
const emptyReview = () => yearReview(2026, [], [], NOW)

describe('the year story slides', () => {
  it('intro: the year, the title, and a switch between years that changes the year', () => {
    const c = ctx()
    const r = richReview()
    draw(<IntroSlide r={r} ctx={c} />)
    expect(screen.getByText(r.title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    expect(c.setYear).toHaveBeenCalledWith(2025)
  })

  it('intro: with one year only there is nothing to switch', () => {
    draw(<IntroSlide r={emptyReview()} ctx={ctx({ years: [2026] })} />)
    expect(screen.queryByRole('button', { name: '2025' })).toBeNull()
  })

  it('total, months, new people: numbers from the year; "not over yet" for the current one', () => {
    const r = richReview()
    expect(r.partial).toBe(true)
    draw(<><TotalSlide r={r} /><MonthsSlide r={r} /><NewPeopleSlide r={r} /></>)
    expect(screen.getByText(t(" The year isn't over yet.").trim(), { exact: false })).toBeInTheDocument()
    expect(screen.getByText(r.busiestMonth!.name)).toBeInTheDocument()
    expect(document.querySelectorAll('.absolute img, .absolute [class*="rounded-full"]').length).toBeGreaterThan(0)
  })

  it('months: a quiet year has no busiest month; new people: over 22 faces are summed up with "and N more"', () => {
    draw(<MonthsSlide r={emptyReview()} />)
    expect(screen.getByText(t('Month by month'))).toBeInTheDocument()
    const r = richReview()
    const many = { ...r, newPeople: Array.from({ length: 30 }, (_, i) => person({ id: `n${i}`, firstName: `Н${i}` })) }
    draw(<NewPeopleSlide r={many} />)
    expect(screen.getByText(new RegExp(t('…and {v} more. ', { v: 8 }).trim()))).toBeInTheDocument()
  })

  it('the top person and the ones after: a leader with several runners-up; nobody at all draws nothing', () => {
    const r = richReview()
    expect(r.topPeople.length).toBeGreaterThan(1)
    const a = draw(<TopPersonSlide r={r} />)
    expect(a.container.textContent).toContain(r.topPeople[0]!.person.firstName)
    a.unmount()
    const b = draw(<TopPersonSlide r={emptyReview()} />)
    expect(b.container.textContent).toBe('')
  })

  it('cities: every city with its bar, the first one marked', () => {
    const r = richReview()
    draw(<CitiesSlide r={r} />)
    for (const c of r.cities) expect(screen.getByText(new RegExp(c.city))).toBeInTheDocument()
  })

  it('warmest: up to three people on a podium, each linking to their page', () => {
    const r = richReview()
    const w = { ...r, warmest: r.topPeople.slice(0, 3).map((x, i) => ({ person: x.person, score: 90 - i * 10, count: x.count })) }
    draw(<WarmestSlide r={w} />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(links[0]!.getAttribute('href')).toMatch(/^\/person\//)
  })

  it.each([
    ['me', { me: 12, them: 3, both: 2, level: 'me' }],
    ['them', { me: 2, them: 14, both: 0, level: 'them' }],
    ['balanced', { me: 8, them: 8, both: 1, level: 'balanced' }],
  ])('reciprocity (%s): the headline and the note agree with the level', (_name, rec) => {
    const r = { ...richReview(), reciprocity: rec as YearReview['reciprocity'] }
    const a = draw(<ReciprocitySlide r={r} />)
    expect(a.container.textContent).toContain(t('You first'))
    if (rec.level === 'balanced') expect(a.container.textContent).toContain(t('Initiative is even'))
    if (rec.both > 0) expect(a.container.textContent).toContain(t('Another {both} times you started together. ', { both: rec.both }).trim())
  })

  it('lost: someone who went quiet, and someone marked as lost, both link to their page', () => {
    const r = richReview()
    const quiet = person({ id: 'q1', firstName: 'Тихон', lastName: 'Молчанов' })
    const marked = person({ id: 'q2', firstName: 'Марк', lastName: 'Отмеченов' })
    draw(<LostSlide r={{ ...r, lost: [{ person: marked, lastAt: null, reason: 'status' }, { person: quiet, lastAt: NOW - 200 * DAY, reason: 'silent' }] }} />)
    expect(screen.getByText(t('Connection marked as lost'))).toBeInTheDocument()
    expect(screen.getAllByRole('link').map(l => l.getAttribute('href'))).toEqual(['/person/q2', '/person/q1'])
  })

  it('summary: the card, "Copy summary" and "Close" work; after copying the button says so', () => {
    const c = ctx()
    const r = richReview()
    const a = draw(<SummaryHost r={r} c={c} />)
    fireEvent.click(screen.getByRole('button', { name: t('Copy summary') }))
    expect(c.copy).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t('Close') }))
    expect(c.close).toHaveBeenCalled()
    a.unmount()
    draw(<SummarySlide r={emptyReview()} ctx={ctx({ copied: true })} />)
    expect(screen.getByRole('button', { name: t('Copied ✓') })).toBeInTheDocument()
  })
})

const SummaryHost = ({ r, c }: { r: YearReview; c: SlideCtx }) => <SummarySlide r={r} ctx={c} />
