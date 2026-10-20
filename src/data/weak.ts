import type { GraphAnalysis } from './graph'
import type { Interaction, Person } from './types'
import { DAY } from '@/lib/format'
import { contactAnchor } from './logic'
import { t, tn } from '@/i18n'

/**
 * Weak ties (Granovetter): new opportunities come more often from distant acquaintances than from close ones,
 * because they live in other worlds. Here are the distant acquaintances with the most potential.
 */
export interface WeakTie {
  person: Person
  /** 0–100 */
  score: number
  reasons: string[]
  daysSince: number | null
}

const CONTACT = new Set(['meeting', 'call', 'message', 'event'])
const SENIOR = /founder|co-?founder|ceo|cto|cfo|coo|cpo|vp\b|head of|director|partner|investor|principal|managing|основател|директор|руководител|партнёр|партнер|инвестор|глава|владел|председател/i

const isWeak = (p: Person, contactsYear: number) => p.closeness >= 3 || (p.closeness === 2 && contactsYear <= 2)

export function weakTies(people: Person[], ints: Interaction[], graph: GraphAnalysis, now = Date.now()): WeakTie[] {
  const net = people.filter(p => !p.archived && !p.familyOf && !p.lifeStatus && !p.everyday)
  const year = new Map<string, number>()
  for (const i of ints) if (CONTACT.has(i.type) && now - i.date <= 365 * DAY) for (const id of i.personIds) year.set(id, (year.get(id) ?? 0) + 1)

  const cities = new Map<string, number>()
  for (const p of net) { const c = p.city?.trim().toLowerCase(); if (c) cities.set(c, (cities.get(c) ?? 0) + 1) }
  const bridgeOf = new Map(graph.bridges.map(b => [b.person.id, b]))
  const clusterName = new Map(graph.clusters.map(c => [c.id, c.name]))

  return net
    .filter(p => isWeak(p, year.get(p.id) ?? 0))
    .map(p => {
      let score = 0
      const reasons: string[] = []
      const b = bridgeOf.get(p.id)
      if (b) {
        score += 22 + b.score * 22
        const names = b.clusters.map(c => clusterName.get(c)).filter((x): x is string => !!x).slice(0, 2)
        reasons.push(names.length === 2 ? t('A bridge between the worlds “{v}” and “{v2}”', { v: names[0]!, v2: names[1]! }) : t('Knows people from different groups'))
      }
      const deg = graph.degree.get(p.id) ?? 0
      if (deg >= 3) { score += Math.min(14, deg * 2.5); reasons.push(tn(deg, 'Knows {n} person from your network', 'Knows {n} people from your network')) }

      const city = p.city?.trim().toLowerCase()
      if (city && (cities.get(city) ?? 0) <= 2) { score += 14; reasons.push(t('Lives in “{city}”, where you know almost no one', { city: p.city ?? '' })) }

      const help = [p.iCanHelp, p.canHelpMe, p.lookingFor].some(x => x?.trim())
      if (p.canHelpMe?.trim()) { score += 16; reasons.push(t('Can help: {v}', { v: p.canHelpMe.trim().slice(0, 70) })) }
      else if (help) score += 6

      if (SENIOR.test(`${p.role ?? ''} ${p.company ?? ''}`)) { score += 12; reasons.push(p.role ? t('Role: {role}', { role: p.role }) : t('Influential role')) }

      const anchor = contactAnchor(p)
      const daysSince = anchor ? Math.floor((now - anchor) / DAY) : null
      // silent for a long time: the right moment to bring the warmth back before the connection dies out completely
      if (daysSince !== null && daysSince > 120) { score += Math.min(14, (daysSince - 120) / 20); reasons.push(t("Haven't been in touch {v}", { v: daysSince > 330 ? t('for over a year') : t('{round} mo.', { round: Math.round(daysSince / 30) }) })) }
      if (p.closeness === 3) score += 4

      return { person: p, score: Math.round(Math.min(100, score)), reasons: reasons.slice(0, 3), daysSince }
    })
    .filter(x => x.score >= 18 && x.reasons.length > 0)
    .sort((a, b) => b.score - a.score)
}
