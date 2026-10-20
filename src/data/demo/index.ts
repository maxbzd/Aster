import { db, uid } from '../db'
import { blankPerson, DEFAULT_CIRCLES, recomputeLastContact } from '../actions'
import { blankLead } from '../leads'
import type { Channel, Interaction, InteractionType, Person } from '../types'
import { DAY, startOfDay, toISODate } from '@/lib/format'
import { getLocale } from '@/i18n'
import type { DemoPack } from './types'
import { RU_PACK } from './ru'
import { EN_PACK } from './en'

/** A small deterministic random generator: the demo looks the same on every load. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let value2 = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value2 = (value2 + Math.imul(value2 ^ (value2 >>> 7), 61 | value2)) ^ value2
    return ((value2 ^ (value2 >>> 14)) >>> 0) / 4294967296
  }
}

const packFor = (locale: string): DemoPack => (locale === 'ru' ? RU_PACK : EN_PACK)

/** Loads the fictional demo network in the interface language: 32 people with history and 23 reserve contacts. */
export async function loadDemo() {
  const pack = packFor(getLocale())
  const r = rng(42)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!
  const now = Date.now()
  const today = startOfDay(now)

  await db.circles.clear()
  const circles = DEFAULT_CIRCLES.map((c, i) => ({ ...c, id: uid(), order: i }))
  await db.circles.bulkPut(circles)
  const cid = (name: string) => circles.find(c => c.name === name)!.id

  const people: Person[] = pack.seeds.map(s => {
    const channels: Channel[] = []
    if (s.tg) channels.push({ type: 'telegram', value: s.tg })
    if (s.phone) channels.push({ type: 'phone', value: s.phone })
    if (s.email) channels.push({ type: 'email', value: s.email })
    if (s.ig) channels.push({ type: 'instagram', value: s.ig })
    if (s.li) channels.push({ type: 'linkedin', value: s.li })

    let birthday: string | undefined
    if (typeof s.bday === 'number') {
      const d = new Date(today + s.bday * DAY)
      const year = s.age ? d.getFullYear() - s.age : undefined
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      birthday = year ? `${year}-${mm}-${dd}` : `--${mm}-${dd}`
    }
    return blankPerson({
      firstName: s.f,
      lastName: s.l,
      nickname: s.nick,
      role: s.role || undefined,
      company: s.co || undefined,
      city: s.city,
      closeness: s.c,
      circleIds: s.circles.map(cid),
      tags: s.tags,
      cadenceDays: s.cadence,
      birthday,
      metAt: s.met ? toISODate(today - s.met * DAY) : undefined,
      metPlace: s.place,
      metStory: s.story,
      channels,
      facts: s.facts ?? [],
      family: s.family,
      canHelpMe: s.help,
      lookingFor: s.seek,
      iCanHelp: s.ihelp,
      topics: (s.topics ?? []).map(item => ({ id: uid(), text: item, done: false })),
      giftIdeas: s.gifts,
      notes: s.notes,
      pinned: s.pinned,
      createdAt: now - (s.met ?? 400) * DAY,
    })
  })
  const byName = (f: string) => people.find(p => p.firstName === f)!
  pack.relate(byName)
  await db.people.bulkPut(people)

  // interaction history
  const ints: Interaction[] = []
  const types: InteractionType[] = ['meeting', 'call', 'message', 'meeting', 'message', 'event', 'favor_given', 'favor_got', 'gift']
  pack.seeds.forEach((s, i) => {
    const p = people[i]!
    const lastType: InteractionType = s.c === 1 ? pick(['meeting', 'call', 'message']) : pick(['meeting', 'message', 'call', 'event'])
    const lastDate = today - s.last * DAY + Math.floor(9 + r() * 10) * 3600_000
    ints.push({ id: uid(), personIds: [p.id], type: lastType, date: lastDate, title: pick(pack.titles[lastType]), note: r() < 0.7 ? pick(pack.notes[lastType] ?? ['']) || undefined : undefined, createdAt: lastDate })
    const extra = s.c === 1 ? 7 : s.c === 2 ? 5 : s.c === 3 ? 3 : 1
    let value3 = lastDate
    for (let k = 0; k < extra; k++) {
      value3 -= (s.c === 1 ? 10 : s.c === 2 ? 30 : 70) * DAY * (0.6 + r())
      const metTime = s.met ? today - s.met * DAY : 0
      if (value3 < metTime) break
      const ty = pick(types)
      ints.push({ id: uid(), personIds: [p.id], type: ty, date: value3, title: pick(pack.titles[ty]), note: r() < 0.55 ? pick(pack.notes[ty] ?? ['']) || undefined : undefined, createdAt: value3 })
    }
  })
  ints.push(...pack.extraInteractions(byName, today, uid))
  await db.interactions.bulkPut(ints)
  for (const p of people) await recomputeLastContact(p.id)

  await db.reminders.bulkPut(pack.reminders(byName, today, now, uid))
  await loadDemoLeads(pack)
}

/** The demo reserve: 23 strong contacts with sources and tags — to show the section alive. */
export async function loadDemoLeads(pack: DemoPack = packFor(getLocale())) {
  const now = Date.now()
  const batch = 'demo-web-summit'
  await db.leads.bulkPut(pack.leads.map(s => {
    const channels: Channel[] = [
      ...(s.tg ? [{ type: 'telegram' as const, value: s.tg }] : []),
      ...(s.ph ? [{ type: 'phone' as const, value: s.ph }] : []),
      ...(s.em ? [{ type: 'email' as const, value: s.em }] : []),
      ...(s.li ? [{ type: 'linkedin' as const, value: s.li }] : []),
    ]
    const at = now - s.d * DAY - (s.f.length % 5) * 3600_000
    return blankLead({
      firstName: s.f, lastName: s.l, role: s.role, company: s.co, city: s.city, why: s.why, source: s.src, tags: s.tags, channels, star: s.star,
      createdAt: at, updatedAt: at, batchId: s.src === pack.batchSource ? batch : undefined,
    })
  }))
}
