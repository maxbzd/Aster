import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUI } from '@/app/store'
import { db } from '@/data/db'
import { LocaleRoot } from '@/i18n/react'
import { t } from '@/i18n'
import { CadenceHintCard, DatesSection, EverydayToggle, FamilySection, PrefsSection, RhythmMode, StatusBanner } from '@/screens/profile/Sections'
import { personOf } from '../cloud/rows'
import { resetDb } from '../helpers'

const NOW = Date.UTC(2026, 10, 3, 12)
const draw = (node: React.ReactNode) => render(<LocaleRoot><MemoryRouter>{node}</MemoryRouter></LocaleRoot>)
const get = async (id: string) => (await db.people.get(id))!

beforeEach(async () => { await resetDb(); useUI.setState({ sheet: null, toasts: [] }) })

describe('a person away from the network', () => {
  it('says what state they are in, with the note, and returns them to the network in one tap', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга', lifeStatus: 'paused', lifeStatusNote: 'Уехала в экспедицию', lifeStatusAt: 1 } as never))
    const user = userEvent.setup()
    draw(<StatusBanner p={await get('p1')} />)
    expect(await screen.findByText('Уехала в экспедицию')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('Return to network') }))
    await waitFor(async () => expect((await get('p1')).lifeStatus).toBeUndefined())
    expect(useUI.getState().toasts.at(-1)?.text).toBe(t('Back to normal network life'))
  })

  it('"Edit" opens the status sheet', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга', lifeStatus: 'paused' } as never))
    const user = userEvent.setup()
    draw(<StatusBanner p={await get('p1')} />)
    await user.click(await screen.findByRole('button', { name: t('Edit') }))
    expect(useUI.getState().sheet).toEqual({ kind: 'status', personId: 'p1' })
  })

  it('shows nothing for a person in normal life', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга' }))
    const { container } = draw(<StatusBanner p={await get('p1')} />)
    expect(container.textContent).toBe('')
  })
})

describe('the rhythm of contact', () => {
  it('"together every day" turns the reminders off, says so, and can be undone', async () => {
    await db.people.add(personOf('p1', { firstName: 'Маша' }))
    const user = userEvent.setup()
    const { rerender } = draw(<><EverydayToggle p={await get('p1')} /><RhythmMode p={await get('p1')} /></>)
    await user.click(await screen.findByRole('button', { name: new RegExp('каждый день|every day', 'i') }))
    await waitFor(async () => expect((await get('p1')).everyday).toBe(true))
    rerender(<LocaleRoot><MemoryRouter><EverydayToggle p={await get('p1')} /><RhythmMode p={await get('p1')} /></MemoryRouter></LocaleRoot>)
    expect(await screen.findByText(t('Together every day'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Вернуть|restore|Rhythm/i }))
    await waitFor(async () => expect((await get('p1')).everyday).toBeUndefined())
  })

  it('a member of the family has no rhythm at all, and no toggle to set one', async () => {
    await db.people.add(personOf('k1', { firstName: 'Лев', familyOf: 'p1' } as never))
    draw(<><EverydayToggle p={await get('k1')} /><RhythmMode p={await get('k1')} /></>)
    expect(await screen.findByText(t('Family without rhythm'))).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it("Astra's suggestion about the rhythm can be applied or put off", async () => {
    const user = userEvent.setup()
    let applied = 0; let dismissed = 0
    draw(<CadenceHintCard s={{ suggested: 14, message: 'Вы говорите каждые две недели', current: 30 } as never} onApply={() => { applied += 1 }} onDismiss={() => { dismissed += 1 }} who="Ольга" />)
    expect(screen.getByText('Вы говорите каждые две недели')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: new RegExp(t('every 2 weeks')) }))
    await user.click(screen.getByRole('button', { name: t('Not now') }))
    expect([applied, dismissed]).toEqual([1, 1])
  })
})

describe('family, dates and how to communicate', () => {
  it('the family section lists members with their age and opens one, and invites to add the first', async () => {
    await db.people.bulkAdd([personOf('p1', { firstName: 'Ольга' }), personOf('k1', { firstName: 'Лев', familyOf: 'p1', relation: 'child', birthday: '2018-03-02' } as never)])
    const user = userEvent.setup()
    draw(<FamilySection p={await get('p1')} />)
    await user.click((await screen.findAllByRole('button', { name: /Лев/ }))[0]!)
    expect(useUI.getState().sheet).toEqual({ kind: 'family', ownerId: 'p1', id: 'k1' })
    await user.click(screen.getByRole('button', { name: t('Add') }))
    expect(useUI.getState().sheet).toEqual({ kind: 'family', ownerId: 'p1' })
  })

  it('with no family yet, it says what can be added', async () => {
    await db.people.add(personOf('p2', { firstName: 'Игорь' }))
    const user = userEvent.setup()
    draw(<FamilySection p={await get('p2')} />)
    await user.click(await screen.findByRole('button', { name: new RegExp(t('Partner, children, parents — each with their own birthday')) }))
    expect(useUI.getState().sheet).toEqual({ kind: 'family', ownerId: 'p2' })
  })

  it('an old free-text family note can be split into cards', async () => {
    await db.people.add(personOf('p3', { firstName: 'Вера', family: 'Муж Андрей, сын Лев (5)' }))
    const user = userEvent.setup()
    draw(<FamilySection p={await get('p3')} />)
    expect(await screen.findByText(t('From an old family note'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Разложить на карточки/ }))
    await waitFor(async () => expect((await db.people.toArray()).filter(x => x.familyOf === 'p3').length).toBeGreaterThan(0))
  })

  it('the dates section shows the birthday, the other dates, and opens them for editing', async () => {
    await db.people.add(personOf('p4', { firstName: 'Нина', birthday: '1990-11-20', importantDates: [{ id: 'd1', kind: 'anniversary', label: 'Годовщина', date: '2015-06-02', yearly: true, remindDays: 3 }] }))
    const user = userEvent.setup()
    draw(<DatesSection p={await get('p4')} now={NOW} />)
    expect(await screen.findByText(/20 ноября|20 November/i)).toBeInTheDocument()
    await user.click(screen.getByText('Годовщина'))
    expect(useUI.getState().sheet).toEqual({ kind: 'dateEdit', personId: 'p4', id: 'd1' })
  })

  it('an unset birthday is an invitation to fill it in', async () => {
    await db.people.add(personOf('p5', { firstName: 'Петя' }))
    const user = userEvent.setup()
    draw(<DatesSection p={await get('p5')} now={NOW} />)
    await user.click(await screen.findByText(t('Birthday not set')))
    expect(useUI.getState().sheet).toEqual({ kind: 'editPerson', id: 'p5' })
  })

  it('preferences are shown as they were saved, allergies first and plainly; none yet is an invitation', async () => {
    await db.people.bulkAdd([
      personOf('p6', { firstName: 'Света', prefs: { address: 'vy', bestTime: 'evening', allergies: 'орехи', food: 'грузинская кухня', hobbies: ['керамика', 'бег'] } as never }),
      personOf('p7', { firstName: 'Тимур' }),
    ])
    const user = userEvent.setup()
    const { unmount } = draw(<PrefsSection p={await get('p6')} />)
    expect(await screen.findByText('орехи')).toBeInTheDocument()
    expect(screen.getByText('грузинская кухня')).toBeInTheDocument()
    expect(screen.getByText('керамика')).toBeInTheDocument()
    expect(screen.getByText(t('Formal'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('Edit') }))
    expect(useUI.getState().sheet).toEqual({ kind: 'prefs', personId: 'p6' })
    unmount()
    act(() => useUI.getState().close())
    draw(<PrefsSection p={await get('p7')} />)
    await user.click(await screen.findByRole('button', { name: new RegExp(t('Informal or formal, favorite channel, food, allergies, hobbies')) }))
    expect(useUI.getState().sheet).toEqual({ kind: 'prefs', personId: 'p7' })
  })
})
