import type { Interaction, Person } from '@/data/types'
import type { Drafts } from '../schemas'
import type { Occasion } from './occasions'
import { fullName, jobLine, lcFirst as lc } from '@/lib/format'
import { lower } from './text'

const at = (place?: string) => (place ? ` at ${lc(place).replace(/^at\s+/, '')}` : '')
const years = (y: string) => (y === '1' ? 'year' : 'years')

/** Message drafts in English from templates: gender-neutral, no corporate stiffness. Three tones for every occasion. */
export function englishDrafts(p: Person, o: Occasion | null, me: string, people: Person[] = [], lastInt?: Interaction): Drafts {
  const n = p.nickname || p.firstName
  const meLine = me ? `It's ${me}` : "It's me"
  const topic = p.topics.find(item => !item.done)?.text
  const ask = topic ? (/^how\s/i.test(topic) ? `${topic.replace(/\?$/, '')}?` : `How is this going: ${lc(topic)}?`) : 'How are you?'

  switch (o?.kind) {
    case 'birthday':
      return {
        short: `${n}, happy birthday! 🎉 Wishing you a great year.`,
        warm: `${n}, happy birthday! I hope this year brings everything you're hoping for, with the people you love around you and more joy than meetings in your calendar. Big hug!`,
        business: `${n}, happy birthday! Wishing you a strong year and bold decisions${p.company ? ` — for you and for ${p.company}` : ''}. Coffee is on me when you have time.`,
      }
    case 'anniversary': {
      const y = o.data.years ?? '1'
      return {
        short: `${n}, can you believe it — exactly ${y} ${years(y)} ago we met${at(p.metPlace)}. ${ask}`,
        warm: `${n}, it's been ${y} ${years(y)} since we met${p.metPlace ? ` — remember, ${at(p.metPlace).trim()}?` : '!'} I really value that we got talking back then. It's been a while — maybe coffee this week?`,
        business: `${n}, hi! Exactly ${y} ${years(y)} of knowing each other — a good reason to catch up. What's in focus for you now${p.company ? ` at ${p.company}` : ''}?`,
      }
    }
    case 'new':
      return {
        short: `${n}, hi! ${meLine}, we met${at(p.metPlace)}. Great to meet you!`,
        warm: `${n}, hi! ${meLine}${p.metPlace ? ` — ${at(p.metPlace).trim()}` : ''}. It was great talking${topic ? `, especially about ${lc(topic.replace(/^how\s+/i, ''))}` : ''}. Let's keep in touch!`,
        business: `${n}, hi! ${meLine}, we met${at(p.metPlace)}. ${p.iCanHelp ? `As agreed — ${lc(p.iCanHelp)}.` : "Let's continue the conversation."} When is a good time for a call?`,
      }
    case 'promise': {
      const pr = lc(o.data.promise ?? '')
      return {
        short: `${n}, hi! As agreed — ${pr}.`,
        warm: `${n}, hi! I haven't forgotten my promise: ${pr}. How are you?`,
        business: `${n}, hi! Following up on our agreement: ${pr}. Shall we go through the details?`,
      }
    }
    case 'favor': {
      const f = lc(o.data.favor ?? 'your help')
      return {
        short: `${n}, thanks again for ${f}! It helped a lot.`,
        warm: `${n}, I want to thank you once more for ${f}. If I can help in return, just say the word — I'd be glad to.`,
        business: `${n}, thank you for ${f} — it really moved things forward. ${p.iCanHelp ? `In return I can help with this: ${lc(p.iCanHelp)}.` : "If you need help with anything, I'm around."}`,
      }
    }
    case 'need': {
      const h = people.find(x => x.id === o.data.helperId)
      const hn = h ? fullName(h) : 'someone'
      const hj = h && jobLine(h) ? ` (${jobLine(h)})` : ''
      const need = lc(o.data.need ?? '')
      return {
        short: `${n}, hi! I remember your request — “${need}”. I think I know the right person: ${h?.firstName ?? hn}. Shall I introduce you?`,
        warm: `${n}, hi! I've been thinking about your request — “${need}”. There's ${hn}${hj}: I think you two will have plenty to talk about. Shall I introduce you?`,
        business: `${n}, hi! About your request (“${need}”) — I have a contact: ${hn}${hj}. If it's still relevant, I'll write to them and ask if it works for them.`,
      }
    }
    case 'topic': {
      const tp = lc(o.data.topic ?? '')
      return {
        short: `${n}, hi! ${ask}`,
        warm: `${n}, hi! It's been a while — I remembered our chat: ${tp}. How is it going? Tell me!`,
        business: `${n}, hi! I'd like to catch up: ${tp.replace(/\?$/, '')}? Maybe a 15-minute call this week?`,
      }
    }
    case 'holiday':
      return {
        short: `${n}, happy holidays! 🎄`,
        warm: `${n}, happy holidays! Thank you for this year — may the next one be even brighter and your plans come true. Hugs!`,
        business: `${n}, happy holidays! Thank you for this year — it was a pleasure to cross paths. Let's do something together in the new year.`,
      }
    case 'family': {
      const m = o.data.member ?? 'your loved one'
      const today = o.data.days === '0'
      return {
        short: `${n}, hi! ${today ? `It's ${m}'s birthday today` : `${m}'s birthday is coming up`} — pass on my congratulations!`,
        warm: `${n}, hi! ${today ? `I know it's ${m}'s birthday today` : `I remember ${m}'s birthday is soon`}. Give them a hug from me with my warmest wishes. How are you celebrating?`,
        business: `${n}, good day! I'd like to congratulate ${m} — ${today ? 'today is' : 'soon is'} their birthday. Please pass on my warm wishes.`,
      }
    }
    case 'date': {
      const label = lc(o.data.label ?? 'a special day')
      return {
        short: `${n}, hi! I remember ${label} — congratulations!`,
        warm: `${n}, hi! Today is a special day for you — ${label}. Wishing you warmth and joy. How are you celebrating?`,
        business: `${n}, good day! Congratulations on ${label}. Wishing you success and a great mood.`,
      }
    }
    case 'news': {
      const news = lc(o.data.news ?? '')
      return {
        short: `${n}, I saw the news: ${news} — congratulations!`,
        warm: `${n}, I just saw the news: ${news}. So happy for you! How does it feel?`,
        business: `${n}, congratulations: ${news}. If you need help or contacts, just say so.`,
      }
    }
    default: {
      const last = lastInt?.title && !/note/i.test(lastInt.title) ? lower(lastInt.title) : ''
      return {
        short: `${n}, hi! It's been a while — how are you?`,
        warm: `${n}, hi! ${last ? `I remembered — ${last}. ` : ''}It's been a while and I'd love to hear how you are and what's new. Coffee this week?`,
        business: `${n}, hi! I'd like to catch up on what you're focused on${p.company ? ` at ${p.company}` : ''}. Maybe I can help with something.`,
      }
    }
  }
}
