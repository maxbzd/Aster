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

describe('выбор даты', () => {
  it('показывает дату словами, открывает календарь и выбирает день', () => {
    render(<Date1 />)
    const trigger = screen.getByRole('button', { name: 'Дата' })
    expect(trigger).toHaveTextContent('10 октября 2026')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('gridcell', { name: '15 октября 2026' }))
    expect(screen.getByTestId('v')).toHaveTextContent('2026-10-15')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('листает месяцы и не пускает за max', () => {
    render(<Date1 />)
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }))
    expect(screen.getByText('Декабрь 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Вперёд' })).toBeDisabled()
    expect(screen.getByRole('gridcell', { name: '1 января 2027' })).toBeDisabled()
  })

  it('«Удалить» очищает, Escape закрывает только календарь', () => {
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

  it('выбор года и месяца через заголовок', () => {
    render(<Date1 />)
    fireEvent.click(screen.getByRole('button', { name: 'Дата' }))
    fireEvent.click(screen.getByText('Октябрь 2026'))
    fireEvent.click(screen.getByRole('button', { name: 'дек' }))
    expect(screen.getByText('Декабрь 2026')).toBeInTheDocument()
  })
})

describe('выбор времени', () => {
  it('меняет часы и минуты', () => {
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

describe('выбор из списка', () => {
  it('выбирает вариант и показывает его подпись', () => {
    const onChange = vi.fn()
    render(<SelectField value="a" onChange={onChange} label="Роль" options={[{ value: 'a', label: 'Имя' }, { value: 'b', label: 'Компания' }]} />)
    expect(screen.getByRole('button', { name: 'Роль' })).toHaveTextContent('Имя')
    fireEvent.click(screen.getByRole('button', { name: 'Роль' }))
    fireEvent.click(screen.getByRole('option', { name: 'Компания' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
