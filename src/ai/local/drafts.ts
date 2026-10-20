import type { Interaction, Person } from '@/data/types'
import type { Drafts } from '../schemas'
import type { Occasion } from './occasions'
import { fullName, jobLine, lcFirst as lc } from '@/lib/format'
import { lower } from './text'
import { applyAddress } from './style'
import { englishDrafts } from './drafts.en'
import { getLocale } from '@/i18n'

const at = (place?: string) => (place ? `на ${lc(place).replace(/^на\s+/, '')}` : '')

/**
 * Template drafts — gender-neutral, no corporate stiffness. They follow the language of communication set on the card
 * (and "ты/вы" for Russian); without it, the interface language.
 */
export function localDrafts(p: Person, o: Occasion | null, me: string, people: Person[], lastInt?: Interaction): Drafts {
  const lang = p.prefs?.language === 'ru' || p.prefs?.language === 'en' ? p.prefs.language : getLocale()
  if (lang === 'en') return englishDrafts(p, o, me, people, lastInt)
  return applyAddress(ruDrafts(p, o, me, people, lastInt), p)
}

function ruDrafts(p: Person, o: Occasion | null, me: string, people: Person[], lastInt?: Interaction): Drafts {
  const n = p.nickname || p.firstName
  const meLine = me ? `Это ${me}` : 'Это я'
  const topic = p.topics.find(topic2 => !topic2.done)?.text
  const ask = topic ? (/^как\s/i.test(topic) ? `${topic.replace(/\?$/, '')}?` : `Как там: ${lc(topic)}?`) : 'Как ты?'

  switch (o?.kind) {
    case 'birthday':
      return {
        short: `${n}, с днём рождения! 🎉 Пусть этот год будет лучшим.`,
        warm: `${n}, с днём рождения! Желаю, чтобы задуманное получалось легко, рядом были близкие, а поводов для радости было больше, чем дел в календаре. Обнимаю!`,
        business: `${n}, поздравляю с днём рождения! Сильного года и смелых решений${p.company ? ` — и тебе, и ${p.company}` : ''}. С меня кофе, когда будет время.`,
      }
    case 'anniversary': {
      const y = o.data.years
      return {
        short: `${n}, представляешь — ровно ${y} ${y === '1' ? 'год' : Number(y) < 5 ? 'года' : 'лет'} назад мы познакомились${p.metPlace ? ` ${at(p.metPlace)}` : ''}. ${ask}`,
        warm: `${n}, сегодня ${y === '1' ? 'год' : `${y} ${Number(y) < 5 ? 'года' : 'лет'}`} нашему знакомству${p.metPlace ? ` — помнишь, ${at(p.metPlace)}?` : '!'} Очень ценю, что тогда разговорились. Давно не виделись — может, кофе на неделе?`,
        business: `${n}, привет! Ровно ${y} ${y === '1' ? 'год' : 'года'} знакомства — хороший повод сверить новости. Что у тебя сейчас в фокусе${p.company ? ` в ${p.company}` : ''}?`,
      }
    }
    case 'new':
      return {
        short: `${n}, привет! ${meLine}, мы познакомились${p.metPlace ? ` ${at(p.metPlace)}` : ''}. Очень приятно было познакомиться!`,
        warm: `${n}, привет! ${meLine}${p.metPlace ? ` — ${at(p.metPlace)}` : ''}. Было здорово пообщаться${topic ? `, особенно про ${lc(topic.replace(/^как\s+/i, ''))}` : ''}. Давай не теряться!`,
        business: `${n}, привет! ${meLine}, познакомились${p.metPlace ? ` ${at(p.metPlace)}` : ''}. ${p.iCanHelp ? `Как договаривались — ${lc(p.iCanHelp)}.` : 'Давай продолжим разговор.'} Когда удобно созвониться?`,
      }
    case 'promise': {
      const pr = lc(o.data.promise)
      return {
        short: `${n}, привет! Как договаривались — ${pr}.`,
        warm: `${n}, привет! Помню про обещание: ${pr}. Как у тебя дела?`,
        business: `${n}, привет! Возвращаюсь по нашей договорённости: ${pr}. Если удобно — обсудим детали?`,
      }
    }
    case 'favor': {
      const f = lc(o.data.favor)
      return {
        short: `${n}, ещё раз спасибо за ${f}! Это очень помогло.`,
        warm: `${n}, хочу ещё раз сказать спасибо за ${f}. Если могу чем-то помочь в ответ — просто скажи, с радостью.`,
        business: `${n}, спасибо за ${f} — это реально сдвинуло дело. ${p.iCanHelp ? `В ответ могу помочь: ${lc(p.iCanHelp)}.` : 'Если нужна помощь с чем-то — я рядом.'}`,
      }
    }
    case 'need': {
      const h = people.find(x => x.id === o.data.helperId)
      const hn = h ? fullName(h) : 'одним человеком'
      const hj = h && jobLine(h) ? ` (${jobLine(h)})` : ''
      const need = lc(o.data.need)
      return {
        short: `${n}, привет! Помню твой запрос — «${need}». Кажется, есть подходящий человек: ${h?.firstName ?? hn}. Познакомить?`,
        warm: `${n}, привет! Всё думаю про твой запрос — «${need}». Есть ${hn}${hj}: думаю, вам будет о чём поговорить. Познакомить?`,
        business: `${n}, привет! По твоему запросу («${need}») есть контакт: ${hn}${hj}. Если актуально — напишу и спрошу, удобно ли.`,
      }
    }
    case 'topic':
      return {
        short: `${n}, привет! ${ask}`,
        warm: `${n}, привет! Давно не общались — вспомнилось наше: ${lc(o.data.topic)}. Как у тебя с этим? Расскажи!`,
        business: `${n}, привет! Хочу сверить новости: ${lc(o.data.topic).replace(/\?$/, '')}? Может, созвонимся на 15 минут на неделе?`,
      }
    case 'holiday':
      return {
        short: `${n}, с наступающим Новым годом! 🎄`,
        warm: `${n}, с наступающим! Спасибо за этот год — пусть следующий будет ещё ярче, а планы сбываются. Обнимаю!`,
        business: `${n}, с наступающим Новым годом! Спасибо за этот год — было приятно пересекаться. Давай в новом году сделаем что-то вместе.`,
      }
    case 'family': {
      const m = o.data.member ?? 'близкий'
      const today = o.data.days === '0'
      return {
        short: `${n}, привет! ${today ? `Сегодня у ${m} праздник` : `Скоро у ${m} день рождения`} — передай поздравления!`,
        warm: `${n}, привет! ${today ? `Знаю, что сегодня день рождения у ${m}` : `Помню, что скоро день рождения у ${m}`}. Обними от меня и пожелай всего самого тёплого. Как вы собираетесь отмечать?`,
        business: `${n}, добрый день! Хочу поздравить ${m} — ${today ? 'сегодня' : 'скоро'} день рождения. Передайте тёплые пожелания.`,
      }
    }
    case 'date': {
      const label = lc(o.data.label ?? 'важная дата')
      return {
        short: `${n}, привет! Помню про ${label} — поздравляю!`,
        warm: `${n}, привет! Сегодня особенный день для тебя — ${label}. Хочу пожелать тепла и радости. Как отмечаешь?`,
        business: `${n}, добрый день! Поздравляю с датой: ${label}. Желаю успехов и хорошего настроения.`,
      }
    }
    case 'news':
      return {
        short: `${n}, вижу новость: ${lc(o.data.news ?? '')} — поздравляю!`,
        warm: `${n}, только что вижу новость: ${lc(o.data.news ?? '')}. Очень за тебя радостно! Как ощущения?`,
        business: `${n}, поздравляю: ${lc(o.data.news ?? '')}. Если пригодится помощь или контакты — скажи.`,
      }
    default: {
      const last = lastInt?.title && !/заметка/i.test(lastInt.title) ? lower(lastInt.title) : ''
      return {
        short: `${n}, привет! Давно не общались — как ты?`,
        warm: `${n}, привет! ${last ? `Вспомнилось — ${last}. ` : ''}Давно не виделись, а хочется узнать, как ты и что нового. Может, кофе на неделе?`,
        business: `${n}, привет! Хочу сверить новости: что у тебя сейчас в фокусе${p.company ? ` в ${p.company}` : ''}? Может, смогу чем-то помочь.`,
      }
    }
  }
}
