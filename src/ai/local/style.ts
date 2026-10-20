import type { Person } from '@/data/types'
import type { Drafts } from '../schemas'

/**
 * Russian "ты" → "вы" (informal → formal address). The templates are written in the informal register, so for people
 * addressed formally they are rewritten by a closed list of replacements, covered by a test: no draft may keep «ты», «тебе», «привет».
 * Other languages have no such switch.
 */
/** Word boundary for Cyrillic: \b in JavaScript only understands Latin. */
const w = (word: string) => new RegExp(`(?<![а-яёА-ЯЁ])${word}(?![а-яёА-ЯЁ])`, 'giu')
const WORDS: Array<[string, string]> = [
  ['привет', 'здравствуйте'],
  ['твоего', 'вашего'], ['твоему', 'вашему'], ['твоим', 'вашим'], ['твоих', 'ваших'], ['твоей', 'вашей'],
  ['твоё', 'ваше'], ['твою', 'вашу'], ['твой', 'ваш'], ['твои', 'ваши'], ['твоя', 'ваша'],
  ['тебя', 'вас'], ['тебе', 'вам'], ['тобой', 'вами'], ['тобою', 'вами'],
  ['помнишь', 'помните'], ['знаешь', 'знаете'], ['представляешь', 'представляете'], ['отмечаешь', 'отмечаете'],
  ['будешь', 'будете'], ['можешь', 'можете'], ['хочешь', 'хотите'], ['видишь', 'видите'],
  ['давай', 'давайте'], ['скажи', 'скажите'], ['расскажи', 'расскажите'], ['передай', 'передайте'],
  ['обними', 'обнимите'], ['пожелай', 'пожелайте'], ['напиши', 'напишите'], ['спрашивай', 'спрашивайте'],
  ['ты', 'вы'],
]
const PAIRS: Array<[RegExp, string]> = WORDS.map(([from, to]) => [w(from), to])
const keepCase = (from: string, to: string) => (from[0] === from[0]!.toUpperCase() && from[0] !== from[0]!.toLowerCase() ? to[0]!.toUpperCase() + to.slice(1) : to)

export function formalize(text: string): string {
  let out = text
  for (const [re, to] of PAIRS) out = out.replace(re, m => keepCase(m, to))
  return out
    .replace(/Обнимаю!/g, 'Всего доброго!')
    .replace(/Здравствуйте!/g, 'Здравствуйте!')
    .replace(/(\p{L}+), здравствуйте!/giu, 'Здравствуйте, $1!') // «Алина, здравствуйте!» → «Здравствуйте, Алина!»
}

export function applyAddress(d: Drafts, p: Person): Drafts {
  if (p.prefs?.address !== 'vy') return d
  return { short: formalize(d.short), warm: formalize(d.warm), business: formalize(d.business) }
}
