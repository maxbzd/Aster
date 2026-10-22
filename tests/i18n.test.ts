import { afterEach, describe, expect, it } from 'vitest'
import { detectLocale, getLocale, registerDictionary, setLocale, t, tn, type Dictionary } from '@/i18n'
import ru from '@/i18n/locales/ru.json'
import es from '@/i18n/locales/es.json'
import de from '@/i18n/locales/de.json'
import fr from '@/i18n/locales/fr.json'
import pt from '@/i18n/locales/pt.json'
import uk from '@/i18n/locales/uk.json'

const base = ru as Dictionary

afterEach(() => {
  registerDictionary('ru', base)
  setLocale('ru')
})

describe('t', () => {
  it('returns the English key when there is no translation', () => {
    setLocale('en')
    expect(t('Some brand new text')).toBe('Some brand new text')
  })
  it('fills placeholders and leaves unknown ones in place', () => {
    setLocale('en')
    expect(t('Hello, {name}! {x}', { name: 'Ann' })).toBe('Hello, Ann! {x}')
  })
  it('translates by key, and a context wins over the plain key', () => {
    registerDictionary('ru', { ...base, 'Open': 'Открыть', 'door\u0004Open': 'Отпереть' })
    expect(t('Open')).toBe('Открыть')
    expect(t('Open', undefined, 'door')).toBe('Отпереть')
    expect(t('Open', undefined, 'unknown-ctx')).toBe('Открыть')
  })
})

describe('tn: plural forms', () => {
  const key = 'testday {n}'
  const forms = ['{n} день', '{n} дня', '{n} дней', '{n} дня']
  it.each([
    [0, '0 дней'], [1, '1 день'], [2, '2 дня'], [4, '4 дня'], [5, '5 дней'], [11, '11 дней'], [12, '12 дней'],
    [21, '21 день'], [22, '22 дня'], [25, '25 дней'], [101, '101 день'], [111, '111 дней'], [1000, '1000 дней'],
  ])('ru: %i → %s', (n, text) => {
    registerDictionary('ru', { ...base, [key]: forms })
    expect(tn(n, key, 'unused')).toBe(text)
  })
  it('en: one / other from the keys themselves', () => {
    setLocale('en')
    expect(tn(1, '{n} day', '{n} days')).toBe('1 day')
    expect(tn(0, '{n} day', '{n} days')).toBe('0 days')
    expect(tn(5, '{n} day', '{n} days')).toBe('5 days')
  })
  it('ru: fractional numbers use the last form', () => {
    registerDictionary('ru', { ...base, [key]: forms })
    expect(tn(1.5, key, 'unused')).toBe('1.5 дня')
  })
})

describe('detectLocale', () => {
  it('takes the first supported language from the list', () => {
    expect(detectLocale(['pl-PL', 'ru-RU', 'en-US'])).toBe('ru')
    expect(detectLocale(['de-DE', 'ru-RU', 'en-US'])).toBe('de')
    expect(detectLocale(['pt-BR'])).toBe('pt')
    expect(detectLocale(['uk-UA', 'ru'])).toBe('uk')
    expect(detectLocale(['en-GB'])).toBe('en')
  })
  it('falls back to English', () => {
    expect(detectLocale(['pl', 'ja'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })
  it('the test suite runs in Russian', () => expect(getLocale()).toBe('ru'))
})

describe('translations in every language', () => {
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join()
  const loaded: [string, Dictionary][] = [
    ['es', es], ['de', de], ['fr', fr], ['pt', pt], ['uk', uk],
  ].map(([id, d]) => [id as string, d as Dictionary])

  it.each(loaded)('%s: same messages and placeholders as the Russian dictionary', (_id, dict) => {
    const bad: string[] = []
    for (const [k, v] of Object.entries(base)) {
      const x = dict[k]
      if (x === undefined) { bad.push(`missing: ${k}`); continue }
      if (Array.isArray(v) !== Array.isArray(x)) { bad.push(`shape: ${k}`); continue }
      if (!Array.isArray(x) && ph(k.includes('\u0004') ? k.split('\u0004')[1]! : k) !== ph(x as string)) bad.push(`placeholders: ${k}`)
    }
    expect(bad).toEqual([])
  })

  it('plural forms follow each language: Ukrainian has four, the rest of the Latin-script ones two', () => {
    const key = 'testday {n}'
    registerDictionary('uk', { [key]: ['{n} день', '{n} дні', '{n} днів', '{n} дня'] })
    setLocale('uk')
    expect([1, 2, 5, 21, 1.5].map(n => tn(n, key, 'unused'))).toEqual(['1 день', '2 дні', '5 днів', '21 день', '1.5 дня'])
    registerDictionary('es', { [key]: ['{n} día', '{n} días'] })
    setLocale('es')
    expect([1, 2, 1_000_000].map(n => tn(n, key, 'unused'))).toEqual(['1 día', '2 días', '1000000 días'])
  })

  it('dates are named in the interface language', async () => {
    const { dateLong, monthGen, weekday } = await import('@/lib/format')
    const { calendarNames } = await import('@/lib/calendar')
    setLocale('de')
    expect(monthGen(2)).toMatch(/^m(ä|a)rz$/i)
    expect(weekday(new Date(2024, 0, 7))).toBe('Sonntag')
    expect(dateLong(new Date(2020, 5, 3))).toContain('Juni')
    expect(calendarNames().weekAbbr).toHaveLength(7)
    setLocale('uk')
    expect(monthGen(2)).toBe('березня')
    expect(calendarNames().monthsNom[2]).toBe('Березень')
  })
})

describe('dictionary', () => {
  it('has the same placeholders in every translation', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join()
    const bad: string[] = []
    for (const [k, v] of Object.entries(base)) {
      const key = k.includes('\u0004') ? k.split('\u0004')[1]! : k
      for (const form of Array.isArray(v) ? v : [v]) {
        const extra = [...form.matchAll(/\{(\w+)\}/g)].map(m => m[1]!).filter(p => p !== 'n' && !key.includes(`{${p}}`))
        if (extra.length) bad.push(`${k} → ${form}`)
      }
      if (!Array.isArray(v) && ph(key) !== ph(v)) bad.push(`${k} → ${v}`)
    }
    expect(bad).toEqual([])
  })
})
