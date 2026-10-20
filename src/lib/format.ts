import { getLocale, intlTag, t, tn } from '@/i18n'

export const DAY = 86_400_000

export const startOfDay = (value: number | Date = Date.now()) => {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const daysBetween = (a: number, b: number) => Math.round((startOfDay(b) - startOfDay(a)) / DAY)

/** "today", "yesterday", "3 days ago", "2 weeks ago", "5 months ago" */
export function ago(time?: number, now = Date.now()) {
  if (!time) return t('never')
  const d = daysBetween(time, now)
  if (d <= 0) return t('today')
  if (d === 1) return t('yesterday')
  if (d < 7) return tn(d, '{n} day ago', '{n} days ago')
  if (d < 30) return tn(Math.round(d / 7), '{n} week ago', '{n} weeks ago')
  if (d < 365) return tn(Math.round(d / 30), '{n} month ago', '{n} months ago')
  return tn(Math.round(d / 365), '{n} year ago', '{n} years ago')
}

/** Short form for lists: 3d, 2w, 5mo */
export function agoShort(time?: number, now = Date.now()) {
  if (!time) return '—'
  const d = daysBetween(time, now)
  if (d <= 0) return t('today')
  if (d < 7) return t('{n}d', { n: d })
  if (d < 30) return t('{n}w', { n: Math.round(d / 7) })
  if (d < 365) return t('{n}mo', { n: Math.round(d / 30) })
  return t('{n}y', { n: Math.round(d / 365) })
}

export function inDays(d: number) {
  if (d === 0) return t('today')
  if (d === 1) return t('tomorrow')
  if (d === 2) return t('the day after tomorrow')
  if (d < 0) return tn(-d, '{n} day ago', '{n} days ago')
  return tn(d, 'in {n} day', 'in {n} days')
}

const MONTHS: Record<'en' | 'ru', { long: string[]; short: string[] }> = {
  en: {
    long: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  // genitive case: "5 марта"
  ru: {
    long: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    short: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  },
}
const WEEKDAYS: Record<'en' | 'ru', string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
}

/** "March 5" / "March 5, 2027" in English, "5 марта 2027" in Russian. The year is shown only when it is not the current one. */
export const dateLong = (time: number | Date, withYear = true) => {
  const d = new Date(time)
  const year = withYear && d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() : null
  const l = getLocale()
  const month = MONTHS[l].long[d.getMonth()]
  if (l === 'en') return `${month} ${d.getDate()}${year ? `, ${year}` : ''}`
  return `${d.getDate()} ${month}${year ? ` ${year}` : ''}`
}
export const dateShort = (time: number | Date) => {
  const d = new Date(time)
  const l = getLocale()
  const month = MONTHS[l].short[d.getMonth()]
  return l === 'en' ? `${month} ${d.getDate()}` : `${d.getDate()} ${month}`
}
export const weekday = (time: number | Date) => WEEKDAYS[getLocale()][new Date(time).getDay()]!
/** Month name (0–11) in the form used after a day number: "марта" / "March". */
export const monthGen = (m: number) => MONTHS[getLocale()].long[m]!
export const timeHM = (time: number) => new Date(time).toLocaleTimeString(intlTag(), { hour: '2-digit', minute: '2-digit' })

export function greeting(now = new Date()) {
  const h = now.getHours()
  if (h < 5) return t('Good night')
  if (h < 12) return t('Good morning')
  if (h < 18) return t('Good afternoon')
  return t('Good evening')
}

export const toISODate = (value2: number | Date) => {
  const d = new Date(value2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
export const fromISODate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).getTime()
}

export const fullName = (p: { firstName: string; lastName?: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ')

export const initials = (p: { firstName: string; lastName?: string }) =>
  ((p.firstName?.[0] ?? '') + (p.lastName?.[0] ?? '')).toUpperCase() || '·'

export const jobLine = (p: { role?: string; company?: string }) =>
  [p.role, p.company].filter(Boolean).join(' · ')

/** Lower-cases the first letter but leaves abbreviations (CTO, AI, MENA) alone. */
export const lcFirst = (s?: string | null) => (!s ? '' : /^[A-ZА-ЯЁ]{2}/.test(s) ? s : s[0].toLowerCase() + s.slice(1))
