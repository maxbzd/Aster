import { getLocale, localeInfo } from '@/i18n'
import { PROMPTS_EN } from './prompts.en'
import { PROMPTS_RU } from './prompts.ru'

/** System prompts of Astra, one per task. The language of the prompt is the interface language, and the model answers in it. */
export interface Prompts {
  capture: string
  brief: string
  ask: string
  note: string
  draft: string
  leadDraft: string
  match: string
  intro: string
  weekly: string
  news: string
  chat: string
}

const withLanguage = (p: Prompts, language: string): Prompts =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, `${v}\n\nAlways write the user-facing text of your answer in ${language}.`])) as unknown as Prompts

const cache = new Map<string, Prompts>()

/**
 * Prompts are written in English and Russian. For any other interface language the English prompts are used with
 * an added instruction to answer in that language, so a new translation works with a cloud model out of the box.
 */
export const prompts = (): Prompts => {
  const locale = getLocale()
  if (locale === 'ru') return PROMPTS_RU
  if (locale === 'en') return PROMPTS_EN
  const name = (localeInfo(locale) as { name: string }).name
  if (!cache.has(name)) cache.set(name, withLanguage(PROMPTS_EN, name))
  return cache.get(name)!
}
