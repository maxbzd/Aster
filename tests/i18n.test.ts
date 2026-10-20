import { afterEach, describe, expect, it } from 'vitest'
import { detectLocale, getLocale, registerDictionary, setLocale, t, tn, type Dictionary } from '@/i18n'
import ru from '@/i18n/locales/ru.json'

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
    expect(detectLocale(['de-DE', 'ru-RU', 'en-US'])).toBe('ru')
    expect(detectLocale(['en-GB'])).toBe('en')
  })
  it('falls back to English', () => {
    expect(detectLocale(['de', 'fr'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })
  it('the test suite runs in Russian', () => expect(getLocale()).toBe('ru'))
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
