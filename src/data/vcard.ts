import type { Channel, Person } from './types'
import { blankPerson } from './actions'

/* ---------- Парсинг .vcf (iPhone, Android, Google) ---------- */

function decodeQP(s: string) {
  const bytes: number[] = []
  const str = s
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '=' && /^[0-9A-F]{2}$/i.test(str.slice(i + 1, i + 3))) {
      bytes.push(parseInt(str.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(str.charCodeAt(i))
  }
  try { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)) } catch { return str }
}

/** Составные поля vCard делятся по «;», но «\;» внутри значения — не разделитель. */
const splitFields = (s: string) => s.split(/(?<!\\);/)
const unescapeValue = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

interface Prop { name: string; params: Record<string, string>; value: string }

function parseLines(card: string): Prop[] {
  // разворачиваем folding (строки с пробелом в начале) и мягкие переносы quoted-printable
  const lines: string[] = []
  for (const l of card.replace(/\r\n?/g, '\n').split('\n')) {
    const prev = lines[lines.length - 1]
    if (prev !== undefined && (l.startsWith(' ') || l.startsWith('\t'))) { lines[lines.length - 1] = prev + l.slice(1); continue }
    if (prev !== undefined && /QUOTED-PRINTABLE/i.test(prev.split(':')[0]) && prev.endsWith('=')) { lines[lines.length - 1] = prev.slice(0, -1) + l; continue }
    if (l.trim()) lines.push(l)
  }
  return lines.map(line => {
    const i = line.indexOf(':')
    if (i < 0) return null
    const [nameRaw, ...ps] = line.slice(0, i).split(';')
    const name = nameRaw.replace(/^item\d+\./i, '').toUpperCase()
    const params: Record<string, string> = {}
    for (const p of ps) {
      const eq = p.indexOf('=')
      const k = eq >= 0 ? p.slice(0, eq).toUpperCase() : 'TYPE'
      const v = (eq >= 0 ? p.slice(eq + 1) : p).toUpperCase()
      params[k] = params[k] ? `${params[k]},${v}` : v
    }
    let value = line.slice(i + 1)
    if (params.ENCODING === 'QUOTED-PRINTABLE') value = decodeQP(value)
    return { name, params, value }
  }).filter((x): x is Prop => !!x)
}

export function parseVCards(text: string): Person[] {
  const cards = text.split(/BEGIN:VCARD/i).slice(1).map(c => c.split(/END:VCARD/i)[0])
  const out: Person[] = []
  for (const card of cards) {
    const props = parseLines(card)
    const get = (n: string) => props.find(p => p.name === n)
    const all = (n: string) => props.filter(p => p.name === n)
    let firstName = ''
    let lastName = ''
    const n = get('N')
    if (n) {
      const parts = splitFields(n.value).map(unescapeValue)
      lastName = parts[0]?.trim() ?? ''
      firstName = [parts[1], parts[2]].filter(Boolean).join(' ').trim()
    }
    const fn = get('FN')?.value.trim()
    if (!firstName && !lastName && fn) {
      const sp = unescapeValue(fn).split(/\s+/)
      firstName = sp[0]
      lastName = sp.slice(1).join(' ')
    }
    if (!firstName && lastName) { firstName = lastName; lastName = '' }
    if (!firstName) continue

    const channels: Channel[] = []
    for (const item of all('TEL')) channels.push({ type: 'phone', value: item.value.trim() })
    for (const e of all('EMAIL')) channels.push({ type: 'email', value: e.value.trim() })
    for (const u of [...all('URL'), ...all('X-SOCIALPROFILE')]) {
      const v = u.value.trim().replace(/^x-apple:/, '')
      if (/t\.me|telegram/i.test(v) || /TELEGRAM/.test(u.params.TYPE ?? '')) channels.push({ type: 'telegram', value: v.replace(/^https?:\/\/t\.me\//, '') })
      else if (/instagram/i.test(v)) channels.push({ type: 'instagram', value: v.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '') })
      else if (/linkedin/i.test(v)) channels.push({ type: 'linkedin', value: v })
      else if (/twitter|x\.com/i.test(v)) channels.push({ type: 'x', value: v.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, '') })
      else if (v) channels.push({ type: 'website', value: v })
    }
    const org = splitFields(get('ORG')?.value ?? '')[0]
    const title = get('TITLE')?.value
    const bday = get('BDAY')?.value.trim()
    let birthday: string | undefined
    if (bday) {
      const m = bday.match(/^(\d{4}|--)-?(\d{2})-?(\d{2})/)
      if (m) birthday = m[1] === '--' || m[1] === '1604' ? `--${m[2]}-${m[3]}` : `${m[1]}-${m[2]}-${m[3]}`
    }
    const adr = get('ADR') ? splitFields(get('ADR')!.value) : undefined
    const city = adr?.[3] ? unescapeValue(adr[3]).trim() : undefined
    const note = get('NOTE')?.value
    const photo = get('PHOTO')
    let photoUrl: string | undefined
    if (photo && /^(B|BASE64)$/.test(photo.params.ENCODING ?? '') && photo.value.length > 100) {
      const type = /PNG/i.test(photo.params.TYPE ?? '') ? 'png' : 'jpeg'
      photoUrl = `data:image/${type};base64,${photo.value.replace(/\s/g, '')}`
    } else if (photo?.value.startsWith('data:image')) photoUrl = photo.value

    out.push(blankPerson({
      firstName: unescapeValue(firstName),
      lastName: lastName ? unescapeValue(lastName) : undefined,
      company: org ? unescapeValue(org).trim() || undefined : undefined,
      role: title ? unescapeValue(title).trim() || undefined : undefined,
      birthday,
      city,
      notes: note ? unescapeValue(note) : undefined,
      channels,
      photo: photoUrl,
      closeness: 4,
    }))
  }
  return out
}

/* ---------- Экспорт ---------- */
const vesc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

export function toVCard(p: Person) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vesc(p.lastName ?? '')};${vesc(p.firstName)};;;`, `FN:${vesc([p.firstName, p.lastName].filter(Boolean).join(' '))}`]
  if (p.company) lines.push(`ORG:${vesc(p.company)}`)
  if (p.role) lines.push(`TITLE:${vesc(p.role)}`)
  if (p.birthday) lines.push(`BDAY:${p.birthday}`)
  if (p.city) lines.push(`ADR;TYPE=HOME:;;;${vesc(p.city)};;;`)
  for (const c of p.channels) {
    if (c.type === 'phone' || c.type === 'whatsapp') lines.push(`TEL;TYPE=CELL:${c.value}`)
    else if (c.type === 'email') lines.push(`EMAIL;TYPE=INTERNET:${c.value}`)
    else if (c.type === 'telegram') lines.push(`URL:https://t.me/${c.value.replace(/^@/, '')}`)
    else if (c.type === 'instagram') lines.push(`URL:https://instagram.com/${c.value.replace(/^@/, '')}`)
    else lines.push(`URL:${c.value}`)
  }
  if (p.notes) lines.push(`NOTE:${vesc(p.notes)}`)
  if (p.photo?.startsWith('data:image/jpeg;base64,')) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${p.photo.split(',')[1]}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}
