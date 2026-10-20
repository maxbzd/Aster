import type { CapturePlan } from '@/ai/schemas'
import type { Person } from '@/data/types'
import { dateLong, fullName, weekday } from '@/lib/format'
import { msg, t } from '@/i18n'

/* Voice commands: "Astra, log that Nina and I agreed on Friday" / «Астра, запиши, что с Ниной договорились на пятницу».
   Nothing is saved without confirmation: first the plan in plain words, then "yes" or "no". Both languages are understood at once. */

const WAKE = /^\s*(?:(?:эй|окей|ок|привет|слушай|hey|okay|ok|hi|listen)[,\s]+)?(?:астра|астро|астре|астру|астры|astra)(?=[\s,.!:?—-]|$)[\s,.!:—-]*(.*)$/i

/** The phrase after "Astra", or null if the assistant wasn't addressed. An empty string — called, but no command yet. */
export function stripWake(text: string): string | null {
  const m = WAKE.exec(text.replace(/\s+/g, ' '))
  return m ? m[1]!.trim() : null
}

const YES = /^\s*(?:да|ага|угу|верно|точно|подтверждаю|подтверди|давай|ок|окей|хорошо|записывай|сохрани|сохраняй|согласен|согласна|так и есть|yes|yeah|yep|yup|sure|correct|right|confirm|go ahead|save it|save|ok|okay|sounds good|do it|that'?s right)(?:[\s,.!]|$)/i
const NO = /^\s*(?:нет|не надо|не нужно|отмена|отмени|стоп|не записывай|не сохраняй|неправильно|не так|отбой|no|nope|cancel|stop|don'?t|do not|wrong|never ?mind|abort|that'?s wrong)(?:[\s,.!]|$)/i
export const isYes = (value: string) => YES.test(value)
export const isNo = (value2: string) => NO.test(value2)

const RECORD = /^(?:запиши|записать|запомни|добавь|добавить|зафиксируй|отметь|заведи|создай|напомни|поставь\s+напоминание|занеси|log|record|add|save|remember|note|create|set|remind)(?=[\s,.:]|$)/i

export type VoiceIntent = 'record' | 'ask'

export const intentOf = (rest: string): VoiceIntent => (RECORD.test(rest.trim()) ? 'record' : 'ask')

/** "log that Nina and I agreed…" → "Nina and I agreed…" — the text to parse. */
export const captureText = (rest: string) => rest.trim().replace(/^(?:запиши|записать|запомни|добавь|добавить|зафиксируй|отметь|заведи|создай|занеси|log|record|add|save|note|remember|create)[\s,:]+(?:me[\s,]+)?(?:мне[\s,]+)?(?:that[\s,]+)?(?:что[\s,]+)?/i, '').trim() || rest.trim()

const TYPE_WORD: Record<string, string> = {
  meeting: msg('a meeting'), call: msg('a call'), message: msg('a chat'), event: msg('an event'),
  favor_given: msg('a favor you did'), favor_got: msg('a favor you received'), gift: msg('a gift'), note: msg('a note'),
}

const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!, 12).getTime()
  return `${dateLong(date)}, ${weekday(date)}`
}

/** The plan in plain words: what exactly will be saved. Names go in quotes so they need no declension. */
export function describePlan(plan: CapturePlan, people: Person[]): string[] {
  const byId = new Map(people.map(p => [p.id, p]))
  const nameOf = (ref: string | null | undefined) => {
    const d = plan.people.find(x => x.ref === ref)
    if (!d) return null
    const p = d.existing_id ? byId.get(d.existing_id) : undefined
    return p ? fullName(p) : [d.first_name, d.last_name].filter(Boolean).join(' ')
  }
  const lines: string[] = []
  for (const d of plan.people) {
    const name = nameOf(d.ref)
    if (!d.existing_id) lines.push(`${t('Create a new card: “{name}”', { name: name ?? '' })}${d.company ? `, ${d.company}` : ''}`)
    else {
      const extra = [d.facts.length && t('facts', undefined, 'voice'), d.topics.length && t('topics for conversation'), d.looking_for && t('what they look for'), d.can_help && t('what they are strong at'), d.city && t('city', undefined, 'voice'), d.birthday && t('birthday')].filter(Boolean)
      if (extra.length) lines.push(t('Update the card “{name}”: {extra}', { name: name ?? '', extra: extra.join(', ') }))
    }
  }
  const i = plan.interaction
  if (i) {
    const who = i.person_refs.map(nameOf).filter(Boolean).map(n => `«${n}»`).join(', ')
    lines.push(`${t('Add {type}', { type: TYPE_WORD[i.type] ? t(TYPE_WORD[i.type]!) : t('an entry') })}${who ? ` ${t('— participants: {who}', { who })}` : ''}, ${t('today')}${i.summary ? `: «${i.summary}»` : ''}`)
  }
  for (const r of plan.reminders) {
    const n = nameOf(r.person_ref)
    lines.push(`${t('Set a reminder “{text}” for {day}', { text: r.text, day: day(r.due_date) })}${n ? ` ${t('(person: “{name}”)', { name: n })}` : ''}`)
  }
  return lines
}

/** The question to read aloud: short and without quote marks. */
export const spokenConfirm = (lines: string[]) => `${lines.map(l => l.replace(/[«»“”]/g, '')).join('. ')}. ${t('Save? Say yes or no.')}`
