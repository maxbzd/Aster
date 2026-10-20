import { uid } from '@/data/db'
import { t } from '@/i18n'

const pad = (n: number) => String(n).padStart(2, '0')
const dt = (value: number) => {
  const d = new Date(value)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
}
const dOnly = (value2: number) => { const d = new Date(value2); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` }
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

export function download(filename: string, content: string | Blob, type = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** RFC 5545: lines longer than 75 octets are folded, the continuation starts with a space. A character is never cut in half. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (size + n > 75) { out.push(cur); cur = ' '; size = 1 }
    cur += ch
    size += n
  }
  out.push(cur)
  return out.join('\r\n')
}

function wrap(events: string[]) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aster//RU', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].map(foldLine).join('\r\n') + '\r\n'
}

export function reminderICS(title: string, at: number, note?: string) {
  return wrap([
    'BEGIN:VEVENT', `UID:${uid()}@aster`, `DTSTAMP:${dt(Date.now())}`, `DTSTART:${dt(at)}`, `DTEND:${dt(at + 30 * 60000)}`,
    `SUMMARY:${esc(title)}`, note ? `DESCRIPTION:${esc(note)}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM',
    'END:VEVENT',
  ].filter(Boolean))
}

export function birthdayICS(name: string, nextDate: number) {
  const next = dOnly(nextDate)
  const nd = new Date(nextDate)
  const end = dOnly(new Date(nd.getFullYear(), nd.getMonth(), nd.getDate() + 1).getTime()) // not "+24 hours": on the day the clocks change that is the same day
  return wrap([
    'BEGIN:VEVENT', `UID:${uid()}@aster`, `DTSTAMP:${dt(Date.now())}`,
    `DTSTART;VALUE=DATE:${next}`, `DTEND;VALUE=DATE:${end}`, 'RRULE:FREQ=YEARLY',
    `SUMMARY:${esc(t('🎂 Birthday: {name}', { name }))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT15H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t("Tomorrow is {name}'s birthday", { name }))}`, 'END:VALARM',
    'END:VEVENT',
  ])
}
