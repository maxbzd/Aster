/* Чистая календарная арифметика для выбора даты. Даты — строки «ГГГГ-ММ-ДД» по местному времени, без часовых поясов. */

import { getLocale, type Locale } from '@/i18n'
import { monthGen } from '@/lib/format'

export interface Cell { iso: string; y: number; m: number; d: number; inMonth: boolean }

export const pad2 = (n: number) => String(n).padStart(2, '0')
export const isoOf = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${pad2(m + 1)}-${pad2(d)}`

/** Месяц нумеруется с 0, как в Date. Выход за границы (m = -1, 12) переносится в соседний год. */
export function parseISO(s?: string | null): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '')
  if (!r) return null
  const y = Number(r[1]), m = Number(r[2]) - 1, d = Number(r[3])
  const date = new Date(y, m, d)
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? { y, m, d } : null
}

export const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate()

export function addDays(iso: string, n: number) {
  const p = parseISO(iso)
  if (!p) return iso
  const date2 = new Date(p.y, p.m, p.d + n)
  return isoOf(date2.getFullYear(), date2.getMonth(), date2.getDate())
}

export function addMonths(iso: string, n: number) {
  const p = parseISO(iso)
  if (!p) return iso
  const first = new Date(p.y, p.m + n, 1)
  return isoOf(first.getFullYear(), first.getMonth(), Math.min(p.d, daysIn(first.getFullYear(), first.getMonth())))
}

/** 0 — понедельник … 6 — воскресенье. */
export const weekdayIndex = (y: number, m: number, d: number) => (new Date(y, m, d).getDay() + 6) % 7

/** Сетка из шести недель, неделя начинается с понедельника. Хвосты соседних месяцев помечены inMonth: false. */
export function monthGrid(y: number, m: number): Cell[] {
  const lead = weekdayIndex(y, m, 1)
  const out: Cell[] = []
  for (let i = 0; i < 42; i++) {
    const date3 = new Date(y, m, 1 - lead + i)
    out.push({ iso: isoOf(date3.getFullYear(), date3.getMonth(), date3.getDate()), y: date3.getFullYear(), m: date3.getMonth(), d: date3.getDate(), inMonth: date3.getMonth() === ((m % 12) + 12) % 12 })
  }
  return out
}

/** Строки «ГГГГ-ММ-ДД» сравниваются как обычные строки. */
export const outOfRange = (iso: string, min?: string, max?: string) => (!!min && iso < min) || (!!max && iso > max)

export function clampISO(iso: string, min?: string, max?: string) {
  if (min && iso < min) return min
  if (max && iso > max) return max
  return iso
}

const NAMES = {
  en: {
    monthsNom: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    monthsAbbr: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    weekAbbr: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  },
  ru: {
    monthsNom: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    monthsAbbr: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    weekAbbr: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
  },
} satisfies Record<Locale, { monthsNom: string[]; monthsAbbr: string[]; weekAbbr: string[] }>

/** Month and weekday names for the date picker in the current language (the week starts on Monday). */
export const calendarNames = () => NAMES[getLocale()]

/** "October 10, 2026" / "10 октября 2026" */
export function longDate(iso: string, withYear = true) {
  const p = parseISO(iso)
  if (!p) return ''
  const month = monthGen(p.m)
  return getLocale() === 'en' ? `${month} ${p.d}${withYear ? `, ${p.y}` : ''}` : `${p.d} ${month}${withYear ? ` ${p.y}` : ''}`
}

/** Дата и время в миллисекундах ↔ части для выбора времени. */
export function withTime(iso: string, hour: number, minute: number) {
  const p = parseISO(iso)
  return p ? new Date(p.y, p.m, p.d, hour, minute).getTime() : NaN
}
