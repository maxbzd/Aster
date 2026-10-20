import { db } from './db'
import { blankPerson } from './actions'
import type { Closeness, ID, Lead } from './types'
import { t } from '@/i18n'

export function blankLead(partial: Partial<Lead> = {}): Lead {
  const now = Date.now()
  return { id: crypto.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2, 9)}`, createdAt: now, updatedAt: now, firstName: '', tags: [], channels: [], ...partial }
}

export async function saveLead(l: Lead) {
  l.updatedAt = Date.now()
  await db.leads.put(l)
  return l.id
}

export const addLeads = (leads: Lead[]) => db.leads.bulkPut(leads)
export const deleteLeads = (ids: ID[]) => db.leads.bulkDelete(ids)

export async function patchLeads(ids: ID[], fn: (l: Lead) => Partial<Lead>) {
  await db.transaction('rw', db.leads, async () => {
    for (const l of await db.leads.bulkGet(ids)) if (l) await db.leads.update(l.id, { ...fn(l), updatedAt: Date.now() })
  })
}

/** Undoes a whole import. Returns how many cards were removed. */
export async function undoBatch(batchId: ID) {
  const ids = await db.leads.where('batchId').equals(batchId).primaryKeys()
  await db.leads.bulkDelete(ids)
  return ids.length
}

/** Reserve → network: the person becomes a full card and the reserve entry disappears. */
export async function promoteLead(id: ID, opt: { closeness: Closeness; circleIds?: ID[] }) {
  const l = await db.leads.get(id)
  if (!l) return undefined
  const p = blankPerson({
    firstName: l.firstName,
    lastName: l.lastName,
    company: l.company,
    role: l.role,
    city: l.city,
    tags: l.tags,
    channels: l.channels,
    canHelpMe: l.why,
    notes: l.notes,
    metPlace: l.source,
    closeness: opt.closeness,
    circleIds: opt.circleIds ?? [],
    pinned: l.star || undefined,
  })
  await db.transaction('rw', db.people, db.leads, async () => {
    await db.people.put(p)
    await db.leads.delete(id)
  })
  return p.id
}

const q = (s?: string) => { const v = s ?? ''; return /[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }

export function leadsToCSV(leads: Lead[]) {
  const ch = (l: Lead, ...value2: string[]) => l.channels.filter(c => value2.includes(c.type)).map(c => c.value).join(' ')
  const head = [t('First name'), t('Last name'), t('Company'), t('Position'), t('Phone'), t('Email', undefined, 'csv'), 'Telegram', 'Instagram', 'LinkedIn', t('Website'), t('City'), t('Tags'), t('Why valuable'), t('Source'), t('Note'), t('Strong')]
  const rows = leads.map(l => [l.firstName, l.lastName, l.company, l.role, ch(l, 'phone', 'whatsapp'), ch(l, 'email'), ch(l, 'telegram'), ch(l, 'instagram'), ch(l, 'linkedin'), ch(l, 'website', 'x', 'other'), l.city, l.tags.join(', '), l.why, l.source, l.notes, l.star ? t('yes') : ''].map(q).join(','))
  return '﻿' + [head.join(','), ...rows].join('\r\n')
}
