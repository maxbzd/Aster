import type { Person, Reminder } from '@/data/types'
import { fullName } from '@/lib/format'
import type { SyncBody } from './api'
import { t } from '@/i18n'

export const KEY_PREFIX = 'aster:reminder:'
export const keyOf = (id: string) => `${KEY_PREFIX}${id}`
export const idOf = (key: string) => (key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null)

/** Сколько дней после выполнения напоминание ещё сообщается TickTick (чтобы закрыть задачу, даже если приложение долго было закрыто). */
const DONE_WINDOW_DAYS = 45

/**
 * Что отправить в TickTick. Напоминания-отражения обязательств из Орбиты (с bridgeKey) пропускаем: в TickTick их отправляет сама Орбита,
 * иначе одна задача появилась бы дважды.
 */
export function buildPayload(reminders: Reminder[], people: Person[], now = Date.now(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): SyncBody {
  const names = new Map(people.map(p => [p.id, fullName(p)]))
  const open: SyncBody['open'] = []
  const done: string[] = []
  for (const r of reminders) {
    if (r.bridgeKey) continue
    if (!r.done) {
      const who = r.personId ? names.get(r.personId) : undefined
      open.push({ key: keyOf(r.id), title: r.text.trim() || t('Reminder'), notes: who ? `Aster · ${who}` : 'Aster', dueAt: new Date(r.dueAt).toISOString() })
    } else if (r.doneAt && now - r.doneAt < DONE_WINDOW_DAYS * 86_400_000) {
      done.push(keyOf(r.id))
    }
  }
  return { open: open.slice(0, 300), done: done.slice(0, 300), tz }
}
