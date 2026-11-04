import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitInput, PersonPicker } from '@/components/forms'
import { db } from '@/data/db'
import { LocaleRoot } from '@/i18n/react'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { resetDb } from '../helpers'

beforeEach(async () => {
  await resetDb()
  await db.people.bulkAdd([
    personOf('a', { firstName: 'Анна', company: 'Студия', lastContactAt: 3 }),
    personOf('b', { firstName: 'Борис', lastContactAt: 2 }),
    personOf('c', { firstName: 'Вера', lastContactAt: 1 }),
  ])
})

function Picker({ multi = true, exclude, start = [] as string[] }: { multi?: boolean; exclude?: string[]; start?: string[] }) {
  const [value, setValue] = useState(start)
  return <LocaleRoot><PersonPicker value={value} onChange={setValue} multi={multi} exclude={exclude} placeholder="Найти" /><output data-testid="value">{value.join(',')}</output></LocaleRoot>
}

describe('choosing people', () => {
  it('lists people, the most recently contacted first, and narrows by what is typed (name or company)', async () => {
    const user = userEvent.setup()
    render(<Picker />)
    const names = async () => (await screen.findAllByRole('button')).map(b => b.textContent ?? '')
    await waitFor(async () => expect((await names())[0]).toContain('Анна'))
    expect((await names()).map(n => n.slice(0, 4))).toEqual(['Анна', 'Бори', 'Вера'])
    await user.type(screen.getByPlaceholderText('Найти'), 'студ')
    await waitFor(async () => expect((await names()).length).toBe(1))
    await user.clear(screen.getByPlaceholderText('Найти'))
    await user.type(screen.getByPlaceholderText('Найти'), 'ничего-похожего')
    expect(await screen.findByText(t('No one found'))).toBeInTheDocument()
  })

  it('several can be chosen, and a chosen one is taken off by tapping it again', async () => {
    const user = userEvent.setup()
    render(<Picker />)
    await user.click(await screen.findByRole('button', { name: /Борис/ }))
    await user.click(await screen.findByRole('button', { name: /Анна/ }))
    expect(screen.getByTestId('value').textContent).toBe('b,a')
    await user.click(screen.getAllByRole('button', { name: /Борис/ })[0]!)
    expect(screen.getByTestId('value').textContent).toBe('a')
  })

  it('with a single choice, a new pick replaces the old one', async () => {
    const user = userEvent.setup()
    render(<Picker multi={false} start={['a']} />)
    await user.click(await screen.findByRole('button', { name: /Вера/ }))
    expect(screen.getByTestId('value').textContent).toBe('c')
  })

  it('people who must not be offered are left out', async () => {
    render(<Picker exclude={['a', 'b']} />)
    expect(await screen.findByRole('button', { name: /Вера/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Анна/ })).toBeNull()
  })
})

describe('a field that writes to the database', () => {
  it('hands the value out after a pause in typing, not on every letter', async () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    render(<CommitInput value="" onCommit={onCommit} delay={300} aria-label="поле" />)
    const input = screen.getByLabelText('поле')
    fireEvent.change(input, { target: { value: 'О' } })
    fireEvent.change(input, { target: { value: 'Ол' } })
    fireEvent.change(input, { target: { value: 'Оля' } })
    expect(onCommit).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(299) })
    expect(onCommit).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(2) })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('Оля')
    vi.useRealTimers()
  })

  it('leaving the field, or pressing Enter, hands it out at once, and nothing is sent twice', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    render(<CommitInput value="" onCommit={onCommit} aria-label="поле" />)
    const input = screen.getByLabelText('поле') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'Игорь' } })
    fireEvent.keyDown(input, { key: 'Enter' }) // Enter lets go of the field
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('Игорь')
    vi.advanceTimersByTime(1000)
    expect(onCommit).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('shows a new value from outside, unless the person is in the middle of typing', () => {
    const { rerender } = render(<CommitInput value="один" onCommit={() => undefined} aria-label="поле" />)
    expect((screen.getByLabelText('поле') as HTMLInputElement).value).toBe('один')
    rerender(<CommitInput value="два" onCommit={() => undefined} aria-label="поле" />)
    expect((screen.getByLabelText('поле') as HTMLInputElement).value).toBe('два')
    fireEvent.change(screen.getByLabelText('поле'), { target: { value: 'печатаю' } })
    rerender(<CommitInput value="три" onCommit={() => undefined} aria-label="поле" />)
    expect((screen.getByLabelText('поле') as HTMLInputElement).value).toBe('печатаю') // typing is not overwritten
  })
})
