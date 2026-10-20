import type { Interaction, Person, Reminder } from '@/data/types'
import { nextBirthday, warmthOf } from '@/data/logic'
import { nextOccurrence, yearsText, genitive } from '@/data/dates'
import { RELATION_LABEL } from '@/data/family'
import { DAY, daysBetween, fromISODate, inDays, startOfDay } from '@/lib/format'
import { t, tn } from '@/i18n'
import type { MatchPair } from './matches'

export type OccasionKind = 'birthday' | 'anniversary' | 'new' | 'promise' | 'favor' | 'need' | 'topic' | 'silence' | 'holiday' | 'news' | 'family' | 'date'

export interface Occasion {
  id: string
  personId: string
  kind: OccasionKind
  title: string
  detail: string
  priority: number
  /** data for the draft */
  data: Record<string, string>
}

export const OCCASION_META: Record<OccasionKind, { label: string; color: string; emoji: string }> = {
  birthday: { get label() { return t('Birthday') }, color: '#ff8fb8', emoji: '🎂' },
  anniversary: { get label() { return t('Acquaintance anniversary') }, color: '#ffd27a', emoji: '✦' },
  new: { get label() { return t('New acquaintance') }, color: '#5fe3b0', emoji: '👋' },
  promise: { get label() { return t('Promise') }, color: '#ffb36b', emoji: '🤝' },
  favor: { get label() { return t('Say thanks') }, color: '#ffd27a', emoji: '🙏' },
  need: { get label() { return t('You can help') }, color: '#7fd6ff', emoji: '🔗' },
  topic: { get label() { return t('Has a topic') }, color: '#a796ff', emoji: '💬' },
  silence: { get label() { return t("Haven't talked for a while") }, color: '#74a6ff', emoji: '🌙' },
  holiday: { get label() { return t('Holiday') }, color: '#ff8f8f', emoji: '🎄' },
  news: { get label() { return t('News') }, color: '#5fe3b0', emoji: '📰' },
  family: { get label() { return t('Family') }, color: '#ff9ec7', emoji: '🏡' },
  date: { get label() { return t('Important date') }, color: '#ffd27a', emoji: '📅' },
}

const PROMISE_RE = /(отправ|скин|присл|познаком|интро|обещ|поздрав|подел|посовет|порекоменд|верн|догов|send|forward|share|introduc|intro\b|promis|congratulat|recommend|get back|follow up|agree)/i

export function computeOccasions(
  people: Person[],
  interactions: Interaction[],
  reminders: Reminder[],
  matches: MatchPair[],
  now = Date.now(),
): Occasion[] {
  const out: Occasion[] = []
  const today = startOfDay(now)
  const byPerson = new Map<string, Interaction[]>()
  for (const it of interactions) for (const pid of it.personIds) byPerson.set(pid, [...(byPerson.get(pid) ?? []), it])
  const date = new Date(now)
  const byId = new Map(people.map(x => [x.id, x]))

  for (const p of people) {
    if (p.archived || p.lifeStatus === 'irrelevant') continue

    // a family member: reasons are addressed to the owner of the family, since it is they who should be written to
    if (p.familyOf) {
      const owner = byId.get(p.familyOf)
      if (!owner || owner.archived) continue
      const rel = RELATION_LABEL[p.relation ?? 'relative'].toLowerCase()
      const fb = nextBirthday(p.birthday, now)
      if (fb && fb.days <= 7) {
        out.push({
          id: `family-${p.id}`, personId: owner.id, kind: 'family',
          title: fb.days === 0 ? t('Birthday today: {name}', { name: p.firstName }) : t('{name}: birthday {when}', { name: p.firstName, when: inDays(fb.days) }),
          detail: [t('{relation} of {name}', { relation: rel, name: genitive(owner.firstName) }), fb.turning ? t('turns {years}', { years: fb.turning }) : '', p.giftIdeas ? t('gift idea: {idea}', { idea: p.giftIdeas }) : ''].filter(Boolean).join(' · '),
          priority: 99 - fb.days * 5, data: { member: p.firstName, relation: rel, days: String(fb.days), ...(fb.turning ? { turning: String(fb.turning) } : {}) },
        })
      }
      for (const d of p.importantDates ?? []) {
        const o = nextOccurrence(d.date, d.yearly !== false, now)
        if (o && o.days <= (d.remindDays ?? 3)) {
          out.push({ id: `date-${p.id}-${d.id}`, personId: owner.id, kind: 'family', title: `${d.label}: ${p.firstName}`, detail: `${t('{relation} of {name}', { relation: rel, name: genitive(owner.firstName) })}${yearsText({ kind: d.kind, years: o.years }) ? ` · ${yearsText({ kind: d.kind, years: o.years })}` : ''}`, priority: 90 - o.days * 4, data: { member: p.firstName, relation: rel, days: String(o.days) } })
        }
      }
      continue
    }

    const ints = (byPerson.get(p.id) ?? []).sort((a, b) => b.date - a.date)
    const w = warmthOf(p, now)
    const push = (kind: OccasionKind, title: string, detail: string, priority: number, data: Record<string, string> = {}) =>
      out.push({ id: `${kind}-${p.id}`, personId: p.id, kind, title, detail, priority, data })

    // birthday
    const b = nextBirthday(p.birthday, now)
    if (b && b.days <= 7) {
      push('birthday', b.days === 0 ? t('Birthday today') : t('Birthday {inDays}', { inDays: inDays(b.days) }),
        [b.turning ? t('turns {years}', { years: b.turning }) : '', p.giftIdeas ? t('gift idea: {idea}', { idea: p.giftIdeas }) : ''].filter(Boolean).join(' · ') || t('Congratulate in person — it is remembered'),
        100 - b.days * 5, { days: String(b.days) })
    }

    // the person's important dates: anniversaries, name days, jubilees
    for (const d of p.importantDates ?? []) {
      const o = nextOccurrence(d.date, d.yearly !== false, now)
      if (o && o.days <= (d.remindDays ?? 3)) {
        const yt = yearsText({ kind: d.kind, years: o.years })
        push('date', o.days === 0 ? t('Today: {label}', { label: d.label }) : t('{label} {when}', { label: d.label, when: inDays(o.days) }), yt ? `${yt}` : t('A good reason to write personally'), 88 - o.days * 4, { label: d.label, days: String(o.days), ...(o.years ? { years: String(o.years) } : {}) })
      }
    }

    // anniversary of meeting
    if (p.metAt) {
      const met = fromISODate(p.metAt)
      const years = date.getFullYear() - new Date(met).getFullYear()
      const ann = new Date(date.getFullYear(), new Date(met).getMonth(), new Date(met).getDate()).getTime()
      const d = Math.round((ann - today) / DAY)
      if (years >= 1 && d >= -1 && d <= 2) {
        push('anniversary', tn(years, '{n} year of acquaintance', '{n} years of acquaintance'), p.metPlace ? t('You met: {metPlace}', { metPlace: p.metPlace }) : t('A great reason to get back in touch'), 62, { years: String(years) })
      }
      // a fresh acquaintance with no follow-up
      const since = daysBetween(met, now)
      const after = ints.filter(i => startOfDay(i.date) > startOfDay(met) && i.type !== 'note')
      if (since >= 0 && since <= 4 && after.length === 0) {
        push('new', since === 0 ? t('Met today') : since === 1 ? t('Met yesterday') : tn(since, 'Met {n} day ago', 'Met {n} days ago'),
          `${t('Write while the meeting is fresh')}${p.metPlace ? ` · ${p.metPlace}` : ''}`, 90 - since * 4)
      }
    }

    // promises
    const promise = reminders.find(r => r.personId === p.id && !r.done && PROMISE_RE.test(r.text) && daysBetween(now, r.dueAt) <= 3)
    if (promise) push('promise', daysBetween(now, promise.dueAt) < 0 ? t('Promise overdue') : t('Promise'), promise.text, daysBetween(now, promise.dueAt) < 0 ? 92 : 80, { promise: promise.text })

    // a thank-you in return
    const got = ints.find(i => i.type === 'favor_got')
    if (got && now - got.date < 60 * DAY && !ints.some(i => (i.type === 'favor_given' || i.type === 'gift') && i.date > got.date)) {
      push('favor', t('You were helped'), got.title ?? t('Say thanks and offer help in return'), 56, { favor: got.title ?? t('help') })
    }

    // can help with an introduction
    const m = matches.find(x => x.a.id === p.id)
    if (m && p.lookingFor) push('need', t('You can help'), t('Looking for “{need}” — {name} fits', { need: p.lookingFor, name: m.b.firstName }), 74, { need: p.lookingFor, helperId: m.b.id })

    // an open topic while the connection is cooling
    const topic = p.topics.find(topic2 => !topic2.done)
    if (topic && w.level !== 'none' && w.ratio >= 0.8) push('topic', t('Something to talk about'), topic.text, 48 + Math.min(w.ratio * 8, 20), { topic: topic.text })

    // have not been in touch for a long time
    if (p.closeness <= 2 && w.level !== 'none' && w.ratio >= 1.3) {
      push('silence', t("Haven't talked in a while"), tn(w.daysSince, '{n} day without contact', '{n} days without contact'), Math.min(40 + w.ratio * 6, 70))
    }

    // New Year
    const md = date.getMonth() * 100 + date.getDate()
    if ((md >= 1124 || md <= 2) && p.closeness <= 3) push('holiday', t('Holiday season'), t('A warm greeting strengthens the connection for the whole year'), 46)
  }

  return out.sort((a, b) => b.priority - a.priority)
}

/** The best reason for a person. */
export function topOccasionByPerson(list: Occasion[]) {
  const m = new Map<string, Occasion>()
  for (const o of list) if (!m.has(o.personId)) m.set(o.personId, o)
  return m
}
