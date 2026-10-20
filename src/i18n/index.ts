/**
 * Minimal, dependency-free i18n.
 *
 * - The English text IS the message key: `t('Sign in')`. Code stays readable and a missing translation
 *   falls back to English instead of showing a technical key.
 * - Other languages are plain JSON dictionaries (`locales/ru.json`) mapping the English text to a translation. They are loaded
 *   lazily so English users never download them.
 * - Placeholders look like `{name}`. Plurals use `tn(n, '{n} day', '{n} days')`; a dictionary entry for a plural
 *   message is an array of forms in the order given by `LOCALES[x].plural`.
 * - `msg('text')` marks a string for extraction without translating it yet (module-level constants);
 *   call `t(value)` where it is displayed.
 *
 * `npm run i18n:check` verifies that every message used in the source exists in every dictionary.
 */
import { useSyncExternalStore } from 'react'

export type Locale = 'en' | 'ru'
export type LocalePref = Locale | 'auto'
export type Vars = Record<string, string | number>
export type Entry = string | string[]
export type Dictionary = Record<string, Entry>

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

export interface LocaleInfo {
  id: Locale
  /** English name */
  name: string
  /** Name in the language itself */
  native: string
  /** BCP-47 tag for Intl and speech recognition */
  tag: string
  /** Order of plural forms inside a dictionary entry */
  plural: PluralCategory[]
}

export const LOCALES: LocaleInfo[] = [
  { id: 'en', name: 'English', native: 'English', tag: 'en-US', plural: ['one', 'other'] },
  { id: 'ru', name: 'Russian', native: 'Русский', tag: 'ru-RU', plural: ['one', 'few', 'many', 'other'] },
]

export const DEFAULT_LOCALE: Locale = 'en'
const STORAGE_KEY = 'aster.locale'
const CTX = '\u0004'

const loaders: Record<Locale, () => Promise<Dictionary>> = {
  en: async () => ({}),
  ru: () => import('./locales/ru.json').then(m => m.default as Dictionary),
}

const dictionaries: Partial<Record<Locale, Dictionary>> = { en: {} }
const listeners = new Set<() => void>()
let current: Locale = DEFAULT_LOCALE
let rules = new Intl.PluralRules(info(DEFAULT_LOCALE).tag)

function info(l: Locale): LocaleInfo {
  return LOCALES.find(x => x.id === l) ?? LOCALES[0]!
}

export const isLocale = (v: unknown): v is Locale => LOCALES.some(l => l.id === v)
export const getLocale = (): Locale => current
export const localeInfo = (l: Locale = current): LocaleInfo => info(l)
/** BCP-47 tag of the current language: for Intl formatting and speech recognition. */
export const intlTag = (): string => info(current).tag

/** Picks a supported language from the browser's preference list. */
export function detectLocale(langs: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []): Locale {
  for (const raw of langs) {
    const primary = String(raw).toLowerCase().split('-')[0]
    if (isLocale(primary)) return primary
  }
  return DEFAULT_LOCALE
}

export function getLocalePref(): LocalePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (isLocale(v)) return v
  } catch { /* storage is blocked: fall back to auto */ }
  return 'auto'
}

export const resolveLocale = (pref: LocalePref): Locale => (pref === 'auto' ? detectLocale() : pref)

/** Registers a dictionary synchronously (tests, server rendering). */
export function registerDictionary(locale: Locale, dict: Dictionary) {
  dictionaries[locale] = dict
}

export async function loadLocale(locale: Locale): Promise<void> {
  if (dictionaries[locale]) return
  dictionaries[locale] = await loaders[locale]()
}

/** Switches the language immediately; the dictionary must already be loaded (see `loadLocale`). */
export function setLocale(locale: Locale) {
  if (locale === current) return
  current = locale
  rules = new Intl.PluralRules(info(locale).tag)
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  for (const l of listeners) l()
}

/**
 * Runs a synchronous function with another language active, without notifying subscribers or touching the UI.
 * For building text in a fixed language (the model comparison always works in English).
 */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  const prev = current
  const prevRules = rules
  current = locale
  rules = new Intl.PluralRules(info(locale).tag)
  try { return fn() } finally { current = prev; rules = prevRules }
}

/** Called once before the first render: resolves the saved or detected language and loads its dictionary. */
export async function initLocale(): Promise<Locale> {
  const locale = resolveLocale(getLocalePref())
  try { await loadLocale(locale) } catch { return current }
  setLocale(locale)
  return locale
}

/** Saves the user's choice ('auto' follows the browser) and applies it. */
export async function changeLocalePref(pref: LocalePref): Promise<void> {
  try {
    if (pref === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, pref)
  } catch { /* storage is blocked: the choice lasts until reload */ }
  const locale = resolveLocale(pref)
  await loadLocale(locale)
  setLocale(locale)
}

export function subscribeLocale(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Re-renders the component when the language changes and returns the current one. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)

function lookup(key: string, ctx?: string): Entry | undefined {
  const dict = dictionaries[current]
  if (!dict) return undefined
  return (ctx ? dict[ctx + CTX + key] : undefined) ?? dict[key]
}

/** Translates a message. `ctx` disambiguates identical English texts that translate differently. */
export function t(key: string, vars?: Vars, ctx?: string): string {
  const e = lookup(key, ctx)
  return fill(typeof e === 'string' ? e : Array.isArray(e) ? e[0] ?? key : key, vars)
}

/** Plural message: `tn(3, '{n} day', '{n} days')`. `{n}` is filled in automatically. */
export function tn(n: number, one: string, other: string, vars?: Vars, ctx?: string): string {
  const all = { ...vars, n }
  const e = lookup(one, ctx)
  if (Array.isArray(e)) {
    const order = info(current).plural
    const i = order.indexOf(rules.select(n) as PluralCategory)
    return fill(e[i] ?? e[e.length - 1] ?? one, all)
  }
  if (typeof e === 'string') return fill(e, all)
  return fill(n === 1 ? one : other, all)
}

/** Marks a string for extraction without translating it (module-level constants). Translate with `t(value)` when shown. */
export const msg = <S extends string>(s: S): S => s

/** Locale-aware string comparison (names in Latin and Cyrillic sort sensibly in both languages). */
export const collate = (a: string, b: string): number => a.localeCompare(b, info(current).tag)

/** Key under which a contextual message is stored in a dictionary. */
export const ctxKey = (ctx: string, key: string) => ctx + CTX + key
