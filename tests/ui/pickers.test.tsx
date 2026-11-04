import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DateField, DateTimeField, SelectField } from '@/components/pickers'

function Date1({ onEscape }: { onEscape?: () => void }) {
  const [v, setV] = useState('2026-10-10')
  return (
    <div onKeyDown={e => e.key === 'Escape' && onEscape?.()}>
      <DateField value={v} onChange={setV} label="Дата" clearable max="2026-12-31" />
      <output data-testid="v">{v}</output>
    </div>
  )
}

describe('date picker', () => {
  it('shows the date in words, opens the calendar and picks a day', () => {
    render(<Date1 />)
    const trigger = screen.getByRole('button', { name: 'Дата' })
    expect(trigger).toHaveTextContent('10 октября 2026')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('gridcell', { name: '15 октября 2026' }))
    expect(screen.getByTestId('v')).toHaveTextContent('2026-10-15')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('pages through months and does not go past max', () => {
    render(<Date1 />)
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }))
    expect(screen.getByText('Декабрь 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Вперёд' })).toBeDisabled()
    expect(screen.getByRole('gridcell', { name: '1 января 2027' })).toBeDisabled()
  })

  it('"Delete" clears, Escape closes only the calendar', () => {
    const esc = vi.fn()
    render(<Date1 onEscape={esc} />)
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(screen.getByTestId('v')).toHaveTextContent('')
    expect(screen.getByRole('button', { name: 'Дата' })).toHaveTextContent('Выбрать дату')
  })

  it('choosing the year and month through the header', () => {
    render(<Date1 />)
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.click(screen.getByText('Октябрь 2026'))
    fireEvent.click(screen.getByRole('button', { name: 'дек' }))
    expect(screen.getByText('Декабрь 2026')).toBeInTheDocument()
  })
})

describe('time picker', () => {
  it('changes hours and minutes', () => {
    const t0 = new Date(2026, 9, 10, 19, 0).getTime()
    const onChange = vi.fn()
    render(<DateTimeField value={t0} onChange={onChange} label="Когда" />)
    fireEvent.click(screen.getByRole('button', { name: 'Когда' }))
    fireEvent.click(within('Минуты', '05'))
    expect(new Date(onChange.mock.calls.at(-1)![0]).getMinutes()).toBe(5)
    fireEvent.click(screen.getByRole('gridcell', { name: '12 октября 2026' }))
    const d = new Date(onChange.mock.calls.at(-1)![0])
    expect([d.getDate(), d.getHours()]).toEqual([12, 19])
  })
})

function within(listLabel: string, text: string) {
  const list = screen.getByRole('listbox', { name: listLabel })
  return [...list.querySelectorAll('button')].find(b => b.textContent === text)!
}

describe('list picker', () => {
  it('picks an option and shows its label', () => {
    const onChange = vi.fn()
    render(<SelectField value="a" onChange={onChange} label="Роль" options={[{ value: 'a', label: 'Имя' }, { value: 'b', label: 'Компания' }]} />)
    expect(screen.getByRole('button', { name: 'Роль' })).toHaveTextContent('Имя')
    fireEvent.click(screen.getByRole('button', { name: 'Роль' }))
    fireEvent.click(screen.getByRole('option', { name: 'Компания' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('calendar by keyboard', () => {
  const grid = () => screen.getByRole('grid')
  const focused = () => document.activeElement?.getAttribute('data-iso')
  const press = (key: string, extra: object = {}) => fireEvent.keyDown(grid(), { key, ...extra })

  it('arrows move by a day or a week, Home / End to the week\'s edges, PageUp / PageDown by a month (Shift: a year)', () => {
    render(<Date1 />) // 10 Oct 2026, a Saturday
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    press('ArrowLeft'); expect(focused()).toBe('2026-10-09')
    press('ArrowRight'); expect(focused()).toBe('2026-10-10')
    press('ArrowUp'); expect(focused()).toBe('2026-10-03')
    press('ArrowDown'); expect(focused()).toBe('2026-10-10')
    press('Home'); expect(focused()).toBe('2026-10-05') // Monday
    press('End'); expect(focused()).toBe('2026-10-11') // Sunday
    press('PageDown'); expect(focused()).toBe('2026-11-11')
    press('PageUp'); expect(focused()).toBe('2026-10-11')
    press('PageUp', { shiftKey: true }); expect(focused()).toBe('2025-10-11')
    press('a') // other keys do nothing
    expect(focused()).toBe('2025-10-11')
  })

  it('the keyboard cannot walk past the allowed range', () => {
    render(<Date1 />) // max 31 Dec 2026
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    press('PageDown', { shiftKey: true })
    expect(focused()).toBe('2026-12-31')
  })

  it('the title cycles days → months → years; a year leads back to its months, and a month to its days', () => {
    render(<Date1 />)
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.click(screen.getByText('Октябрь 2026'))
    fireEvent.click(screen.getByText('2026')) // months of 2026 -> the years around it
    expect(screen.getByText('2016–2027')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2024' }))
    expect(screen.getByText('2024')).toBeInTheDocument() // the months of 2024
    fireEvent.click(screen.getByRole('button', { name: 'мар' }))
    expect(screen.getByText('Март 2024')).toBeInTheDocument()
  })

  it('years beyond the allowed range cannot be chosen, and the arrows page by twelve years', () => {
    render(<Date1 />)
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.click(screen.getByText('Октябрь 2026'))
    fireEvent.click(screen.getByText('2026'))
    expect(screen.getByRole('button', { name: '2027' })).toBeDisabled() // max is in 2026
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByText('2004–2015')).toBeInTheDocument()
  })

  it('a tap outside closes the calendar; a tap inside does not', () => {
    render(<Date1 />)
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.pointerDown(grid())
    expect(screen.queryByRole('grid')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('grid')).toBeNull()
  })
})

describe('time wheels', () => {
  it('arrow keys step a wheel; scrolling settles on the nearest value after a pause', () => {
    vi.useFakeTimers()
    const t0 = new Date(2026, 9, 10, 19, 0).getTime()
    const onChange = vi.fn()
    render(<DateTimeField value={t0} onChange={onChange} label="Когда" />)
    fireEvent.click(screen.getByRole('button', { name: 'Когда' }))
    const hours = screen.getByRole('listbox', { name: 'Часы' })
    fireEvent.keyDown(hours, { key: 'ArrowUp' })
    expect(new Date(onChange.mock.calls.at(-1)![0]).getHours()).toBe(18)
    fireEvent.keyDown(hours, { key: 'ArrowDown' })
    expect(new Date(onChange.mock.calls.at(-1)![0]).getHours()).toBe(20)
    const n = onChange.mock.calls.length
    fireEvent.keyDown(hours, { key: 'x' })
    expect(onChange).toHaveBeenCalledTimes(n)

    hours.scrollTop = 40 * 7
    fireEvent.scroll(hours)
    vi.advanceTimersByTime(100)
    expect(new Date(onChange.mock.calls.at(-1)![0]).getHours()).toBe(7)
    vi.useRealTimers()
  })
})

describe('list picker by keyboard', () => {
  const opts = [{ value: 'a', label: 'Имя' }, { value: 'b', label: 'Компания' }, { value: 'c', label: 'Город' }]

  it('a list: arrows move between options', () => {
    render(<SelectField value="a" onChange={() => undefined} label="Роль" options={opts} />)
    fireEvent.click(screen.getByRole('button', { name: 'Роль' }))
    const list = screen.getByRole('listbox')
    const first = screen.getByRole('option', { name: 'Имя' })
    first.focus()
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Компания' }))
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(list, { key: 'ArrowLeft' }) // not a list key
    expect(document.activeElement).toBe(first)
  })

  it('a grid of options: left and right move by one, up and down by a row', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
    render(<SelectField value={1} onChange={() => undefined} label="День" options={many} columns={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'День' }))
    const list = screen.getByRole('listbox')
    screen.getByRole('option', { name: '1' }).focus()
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '2' }))
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '5' }))
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '4' }))
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '1' }))
  })
})
