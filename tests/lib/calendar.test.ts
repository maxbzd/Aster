import { describe, expect, it } from 'vitest'
import { addDays, addMonths, clampISO, daysIn, longDate, monthGrid, outOfRange, parseISO, withTime } from '@/lib/calendar'

describe('calendar', () => {
  it('parses and rejects non-existent dates', () => {
    expect(parseISO('2026-10-10')).toEqual({ y: 2026, m: 9, d: 10 })
    expect(parseISO('2026-02-30')).toBeNull()
    expect(parseISO('')).toBeNull()
    expect(parseISO('--10-10')).toBeNull()
  })

  it('the grid: six weeks, starts on Monday, the tails are marked', () => {
    const g = monthGrid(2026, 9) // October 2026: the 1st is a Thursday
    expect(g).toHaveLength(42)
    expect(g[0].iso).toBe('2026-09-28')
    expect(g[3]).toMatchObject({ iso: '2026-10-01', inMonth: true })
    expect(g[0].inMonth).toBe(false)
    expect(g.filter(c => c.inMonth)).toHaveLength(31)
  })

  it('the grid of February in a leap year', () => {
    expect(daysIn(2028, 1)).toBe(29)
    expect(monthGrid(2028, 1).filter(c => c.inMonth)).toHaveLength(29)
  })

  it('shifts by days and months do not run past the end of the month', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15')
  })

  it('min/max bounds', () => {
    expect(outOfRange('2026-10-11', undefined, '2026-10-10')).toBe(true)
    expect(outOfRange('2026-10-10', '2026-10-10', '2026-10-10')).toBe(false)
    expect(clampISO('2030-01-01', undefined, '2026-10-10')).toBe('2026-10-10')
  })

  it('label and time', () => {
    expect(longDate('2026-10-10')).toBe('10 октября 2026')
    expect(longDate('2026-03-01', false)).toBe('1 марта')
    const t = withTime('2026-10-10', 14, 30)
    expect(new Date(t).getHours()).toBe(14)
    expect(new Date(t).getMinutes()).toBe(30)
  })
})
