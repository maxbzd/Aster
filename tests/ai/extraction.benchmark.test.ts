import { appendFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localCapture } from '@/ai/local/parse'
import { setLocale } from '@/i18n'
import { CORPUS, scoreExtractor, type Extracted } from './extraction.corpus'

/** The on-device rule-based engine as an extractor: the first person card it makes from the note. */
const regexEngine = (text: string): Extracted => {
  const d = localCapture(text, [], Date.UTC(2026, 9, 12)).people[0]
  if (!d) return {}
  return { first: d.first_name, role: d.role ?? undefined, city: d.city ?? undefined, fields: d.interests }
}

// The corpus names things by the app's English labels, so the engine answers in English too.
beforeEach(() => setLocale('en'))
afterEach(() => setLocale('ru'))

describe('extraction benchmark: the rule-based engine', () => {
  it('measures the engine per language (the baseline a neural extractor must beat)', async () => {
    const score = await scoreExtractor(regexEngine)
    const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4)
    const rows = Object.entries(score).map(([lang, s]) => `${lang.padEnd(4)} n=${s.notes} person ${pct(s.person)}  role ${pct(s.role)}  city ${pct(s.city)}  field ${pct(s.field)}  whole ${pct(s.whole)}`)
    if (process.env.BENCH_OUT) appendFileSync(process.env.BENCH_OUT, `${rows.join('\n')}\n`)
    // the two languages the engine is built for must stay perfect on this corpus, whatever else changes
    expect(score.en.whole).toBe(1)
    expect(score.ru.whole).toBe(1)
    expect(CORPUS.length).toBe(56)
  })
})

describe('Russian inflection and boundaries', () => {
  it('finds the city after "в" / "из" without a verb before it, and in the forms `\\b` cannot see', () => {
    const city = (text: string) => localCapture(text, [], Date.UTC(2026, 9, 12)).people[0]?.city
    expect(city('Познакомился с Лерой Орловой, она дизайнер в Берлине')).toBe('Berlin')
    expect(city('Познакомился с Лерой Орловой, рекрутер из Вены')).toBe('Vienna')
    expect(city('Познакомился с Лерой Орловой, архитектор из Рима')).toBe('Rome')
  })

  it('knows the adjective forms of an industry', () => {
    const interests = localCapture('Познакомился с Лерой Орловой, директор логистической компании', [], Date.UTC(2026, 9, 12)).people[0]?.interests
    expect(interests).toContain('Logistics')
  })
})
