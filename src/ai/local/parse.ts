import type { Person } from '@/data/types'
import type { CapturePlan, NoteSuggestions, PersonDraft } from '../schemas'
import { DAY, startOfDay, toISODate } from '@/lib/format'
import { msg, t, tn } from '@/i18n'
import {
  cap, clauses, findMentioned, lower, nameToNominative, parseBirthday, parseWhen, personNameRe, surnameToNominative, trimPunct, wordRe,
} from './text'

/*
 * Local (on-device) parsing of a note after a meeting. It understands Russian and English at the same time:
 * every pattern is the union of both languages. What it produces (roles, facts, titles) follows the interface language.
 */

/** Role patterns → English label (shown through `t`). The first match wins. */
const ROLES: [RegExp, string][] = [
  [/технич[а-яёa-z]* директор|\bcto\b|chief (?:technology|technical) officer/i, msg('CTO')],
  [/\bceo\b|генеральн[а-яёa-z]* директор|гендир|chief executive/i, msg('CEO')],
  [/\bcoo\b|операционн[а-яёa-z]* директор|chief operating officer/i, msg('COO')],
  [/\bcmo\b|директор по маркетингу|chief marketing officer/i, msg('CMO')],
  [/\bcpo\b|директор по продукту|chief product officer/i, msg('CPO')],
  [/\bcfo\b|финансов[а-яёa-z]* директор|chief financial officer/i, msg('CFO')],
  [/сооснователь|кофаундер|co-?founders?/i, msg('Co-founder')],
  [/основател[а-яёa-z]*|фаундер|founders?/i, msg('Founder')],
  [/партн[её]р[а-яёa-z]* (?:фонда|в фонде)|венчурн[а-яёa-z]* партн[её]р|(?:venture |general )?partner (?:at|in|of) (?:a |the )?(?:fund|vc)|vc partner/i, msg('Fund partner')],
  [/бизнес-?ангел|ангел-?инвестор|angel investor|business angel/i, msg('Angel investor')],
  [/инвестор[а-яёa-z]*|investors?/i, msg('Investor')],
  [/продакт|product manager|продуктов[а-яёa-z]* менеджер/i, msg('Product Manager')],
  [/дизайнер[а-яёa-z]*|designers?/i, msg('Designer')],
  [/разработчик[а-яёa-z]*|программист[а-яёa-z]*|инженер[а-яёa-z]*|developers?|programmers?|engineers?/i, msg('Developer')],
  [/маркетолог[а-яёa-z]*|marketers?|marketing manager/i, msg('Marketer')],
  [/юрист[а-яёa-z]*|адвокат[а-яёa-z]*|lawyers?|attorneys?/i, msg('Lawyer')],
  [/рекрутер[а-яёa-z]*|\bhr\b|эйчар|recruiters?/i, msg('Recruiter')],
  [/аналитик[а-яёa-z]*|analysts?/i, msg('Analyst')],
  [/журналист[а-яёa-z]*|journalists?|reporters?/i, msg('Journalist')],
  [/продюсер[а-яёa-z]*|producers?/i, msg('Producer')],
  [/врач[а-яёa-z]*|доктор[а-яёa-z]*|doctors?|physicians?|surgeons?/i, msg('Doctor')],
  [/тренер[а-яёa-z]*|coach(?:es)?\b|trainers?/i, msg('Coach')],
  [/предпринимател[а-яёa-z]*|entrepreneurs?/i, msg('Entrepreneur')],
  [/консультант[а-яёa-z]*|consultants?/i, msg('Consultant')],
  [/фотограф[а-яёa-z]*|photographers?/i, msg('Photographer')],
  [/архитектор[а-яёa-z]*|architects?/i, msg('Architect')],
  [/директор[а-яёa-z]*|directors?/i, msg('Director')],
  [/менеджер[а-яёa-z]*|managers?/i, msg('Manager')],
]

/** Industry patterns → tag (English label shown through `t`; proper names stay as they are). */
const INDUSTRIES: [RegExp, string][] = [
  [/финтех|fintech/i, msg('Fintech')], [/edtech|эдтех|образовани|education tech/i, msg('EdTech')],
  [/\bai\b|(?<![а-яё])ии(?![а-яё])|искусственн[а-яёa-z]* интеллект|нейросет|artificial intelligence|machine learning|\bml\b|neural net/i, msg('AI')],
  [/крипт|блокчейн|web3|crypto|blockchain/i, msg('Crypto')], [/медиа|\bmedia\b/i, msg('Media')], [/ритейл|retail/i, msg('Retail')],
  [/геймдев|игр[ыау]|game ?dev|gaming|video games/i, msg('Gamedev')],
  [/healthtech|медицин|здравоохран|health ?care|medtech/i, msg('Healthtech')], [/недвижимост|real estate|proptech/i, msg('Real estate')],
  [/логистик|logistics|supply chain/i, msg('Logistics')], [/saas/i, msg('SaaS')],
]

/** City patterns (Russian stems and English names) → English label (shown through `t`). */
const CITIES: [RegExp, string][] = [
  [/москв|moscow/, msg('Moscow')], [/питер|петербург|спб|petersburg/, msg('Saint Petersburg')], [/дуба|dubai/, msg('Dubai')], [/лиссабон|lisbon/, msg('Lisbon')],
  [/тбилис|tbilisi/, msg('Tbilisi')], [/ереван|yerevan/, msg('Yerevan')], [/белград|belgrade/, msg('Belgrade')], [/алмат|almaty/, msg('Almaty')], [/бали|\bbali\b/, msg('Bali')],
  [/лондон|london/, msg('London')], [/берлин|berlin/, msg('Berlin')], [/нью-?йорк|new york|\bnyc\b/, msg('New York')], [/стамбул|istanbul/, msg('Istanbul')],
  [/казан|kazan/, msg('Kazan')], [/новосибирск|novosibirsk/, msg('Novosibirsk')], [/екатеринбург|yekaterinburg|ekaterinburg/, msg('Yekaterinburg')],
  [/сочи|sochi/, msg('Sochi')], [/минск|minsk/, msg('Minsk')], [/барселон|barcelona/, msg('Barcelona')], [/париж|paris/, msg('Paris')], [/амстердам|amsterdam/, msg('Amsterdam')],
  [/сингапур|singapore/, msg('Singapore')], [/бангкок|bangkok/, msg('Bangkok')], [/пхукет|phuket/, msg('Phuket')], [/тель-?авив|tel[ -]?aviv/, msg('Tel Aviv')],
  [/лимассол|кипр|limassol|cyprus/, msg('Limassol')], [/баку|baku/, msg('Baku')], [/ташкент|tashkent/, msg('Tashkent')], [/сеул|seoul/, msg('Seoul')], [/токио|tokyo/, msg('Tokyo')],
  [/варшав|warsaw/, msg('Warsaw')], [/прага|праге|праги|prague/, msg('Prague')], [/вильнюс|vilnius/, msg('Vilnius')], [/рига|риге|риги|\briga\b/, msg('Riga')],
  [/сан-?франциско|san francisco|\bsf\b|silicon valley|кремниев/, msg('San Francisco')], [/лос-?анджелес|los angeles/, msg('Los Angeles')], [/майами|miami/, msg('Miami')],
  [/торонто|toronto/, msg('Toronto')], [/гонконг|hong kong/, msg('Hong Kong')], [/сидне[йе]|sydney/, msg('Sydney')], [/мадрид|madrid/, msg('Madrid')], [/рим[ае]?\b|\brome\b/, msg('Rome')],
  [/милан|milan/, msg('Milan')], [/вен[аеы]\b|vienna/, msg('Vienna')], [/цюрих|zurich/, msg('Zurich')], [/женев|geneva/, msg('Geneva')], [/брюссел|brussels/, msg('Brussels')],
  [/стокгольм|stockholm/, msg('Stockholm')], [/копенгаген|copenhagen/, msg('Copenhagen')], [/хельсинки|helsinki/, msg('Helsinki')], [/таллин|tallinn/, msg('Tallinn')],
  [/киев|киеве|kyiv|kiev/, msg('Kyiv')], [/афин|athens/, msg('Athens')], [/будапешт|budapest/, msg('Budapest')], [/абу-?даби|abu dhabi/, msg('Abu Dhabi')], [/доха|дохе|doha/, msg('Doha')],
]
const cityIn = (s: string) => {
  const key = CITIES.find(([re]) => re.test(lower(s)))?.[1]
  return key ? t(key) : undefined
}
const cityKey = (s: string) => CITIES.find(([re]) => re.test(lower(s)))?.[1]

const NAME_AFTER = /(?:познакомил[а-я]*|встретил[а-я]*|пообщал[а-я]*|виделись|созвонил[а-я]*|поговорил[а-я]*|пересеклись|обедал[а-я]*|ужинал[а-я]*|пил[аи]? кофе|выпили кофе)\s+с[о]?\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?((?:\s*(?:,|и)\s*[А-ЯЁ][а-яё]+)*)/
const NAMED = /(?:[Зз]овут|[Зз]накомая|[Зз]накомый|[Нн]овый знакомый|[Нн]овая знакомая)\s*[—:-]?\s*([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?/
const NAME_AFTER_EN = /(?:\b[Mm]et|\b[Mm]eeting(?: with)?|[Hh]ad (?:a )?(?:coffee|lunch|dinner|breakfast|call|meeting|chat)(?: with)?|[Tt]alked (?:to|with)|[Ss]poke (?:to|with)|[Cc]hatted with|[Cc]alled|[Cc]aught up with|[Rr]an into|[Bb]umped into|[Ss]aw|[Ii]ntroduced to|[Gg]ot to know)\s+(?:with\s+)?([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?((?:\s*(?:,|and)\s*[A-Z][a-z]+)*)/
const NAMED_EN = /(?:[Nn]ew (?:contact|acquaintance)|[Nn]amed|[Cc]alled)\s*[—:-]?\s*([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/
/** Words that start a sentence and must not be taken for a first name. */
const STARTERS_EN = /^(The|A|An|Just|Also|Then|Today|Yesterday|Tonight|Met|Had|We|He|She|They|I|It|This|That|Note|Reminder|Idea|Plan|Task|Great|Nice|Good|Really|Very|Now|Recently|Later|After|Before|When|If|Thanks|Thank|Hi|Hello|Dear|Talked|Spoke|Chatted|Called|Lunch|Dinner|Coffee|Breakfast|Meeting|Quick|Short|Long|Interesting|Cool|Another|New|Next|Last|First|Second|So|But|And|Or|Also|Still|Maybe|Please|Remember|Need|Don't|Do|Did|Is|Are|Was|Were|Will|Would|Can|Could|Should|My|Our|His|Her|Their|Its|On|In|At|By|To|From|With|For|About|After|During|While|Since|Until|Not|No|Yes|Ok|Okay|Well|Oh|Wow|Hey|Idea|Todo|Followup|Follow-up)$/

function blankDraft(ref: string, first: string, last?: string): PersonDraft {
  return {
    ref, existing_id: null, first_name: first, last_name: last ?? null, role: null, company: null, city: null, family: null,
    facts: [], interests: [], looking_for: null, can_help: null, i_can_help: null, channels: [], birthday: null, met_place: null,
    introduced_by_id: null, topics: [], gift_ideas: null,
  }
}

/** Family words in both languages → canonical English key (displayed through `t`). */
const FAMILY_WORDS: Record<string, string> = {
  жена: msg('wife'), муж: msg('husband'), дочь: msg('daughter'), дочка: msg('daughter'), дочке: msg('daughter'), сын: msg('son'), сыну: msg('son'), девушка: msg('girlfriend'), парень: msg('boyfriend'),
  невеста: msg('fiancée'), жених: msg('fiancé'), ребёнок: msg('child'), ребенок: msg('child'), 'двое детей': msg('two children'), 'трое детей': msg('three children'), дети: msg('children'),
  wife: msg('wife'), husband: msg('husband'), daughter: msg('daughter'), son: msg('son'), girlfriend: msg('girlfriend'), boyfriend: msg('boyfriend'), fiancée: msg('fiancée'), fiancee: msg('fiancée'),
  fiancé: msg('fiancé'), fiance: msg('fiancé'), child: msg('child'), kid: msg('child'), kids: msg('children'), children: msg('children'), 'two kids': msg('two children'), 'three kids': msg('three children'),
  'two children': msg('two children'), 'three children': msg('three children'), partner: msg('partner'),
}
const FAMILY_RE_RU = /(жена|муж|дочь|дочка|сын|сыну|дочке|девушка|парень|невеста|жених|ребёнок|ребенок|двое детей|трое детей|дети)\s*(?:—|-)?\s*([А-ЯЁ][а-яё]+)?(?:[,\s]*(\d{1,2})\s*(?:лет|год|года|мес))?/gi
const FAMILY_RE_EN = /\b(wife|husband|daughter|son|girlfriend|boyfriend|fianc[eé]e?|two kids|three kids|two children|three children|kids|children|child|kid)\b\s*(?:[—:-]|named|called|is)?\s*([A-Z][a-z]+)?(?:[,\s]*\(?(\d{1,2})\s*(?:y\/o|yo|years? old|years?|months?|mo)\)?)?/gi

/** Leading run of capitalized words, at most two: "Spotify as a designer" → "Spotify". */
const capitalizedRun = (s: string) => {
  const out: string[] = []
  for (const w of s.trim().split(/\s+/)) {
    if (!/^[A-Z0-9]/.test(w) || out.length === 2) break
    out.push(w)
  }
  return out.join(' ')
}

/** Extract details about a person from the text (everything that concerns the main character of the note). */
function extractInto(d: PersonDraft, text: string, people: Person[], now: number, reminders: CapturePlan['reminders'], selfName: string) {
  const query = text
  const l = lower(query)

  // "looking for a CTO" describes a request, not the person's job
  const seeking = /(?:ищет|ищут|ищу|ищем|в поиске|хочет найти|нужен|нужна|нужно|нужны|не хватает|порекомендовать|рекомендовать)/i.test(query) ||
    /\b(?:looking for|looks for|seeking|searching for|in search of|wants to find|in need of|needs?)\b/i.test(query)

  // role, industry, company
  if (!d.role && !seeking) { const role = ROLES.find(([re]) => re.test(query))?.[1]; d.role = role ? t(role) : null }
  for (const [re, tag] of INDUSTRIES) if (re.test(query) && !d.interests.includes(t(tag))) d.interests.push(t(tag))
  const coRu = query.match(/(?:в компании|из компании|работает в|работает на|в стартапе|из стартапа|компания)\s+«?([A-ZА-ЯЁ][\wА-Яа-яЁё.&-]*(?:\s+[A-ZА-ЯЁ][\wА-Яа-яЁё.&-]*)?)»?/)
    ?? query.match(/(?:в|из)\s+«([^»]+)»/)
    ?? query.match(/(?:^|\s)(?:в|из)\s+([A-Z][\w.&-]+(?:\s+[A-Z][\w.&-]+)?)/)
  // English: only after a job title or "works at" ("designer at Spotify"); the `i` flag makes [A-Z] match lowercase, so the run of capitalized words is cut by hand
  const coEn = coRu ? null : query.match(/\b(?:works? (?:at|for)|working (?:at|for)|employed (?:at|by)|joined|(?:cto|ceo|coo|cmo|cpo|cfo|founder|co-?founder|partner|head|lead|director|manager|designer|engineer|developer|analyst|recruiter|consultant|investor|photographer|architect|journalist|producer|marketer|lawyer|attorney|doctor)\s*(?:of|at|in|@|,)?)\s+(?:the\s+)?([A-Za-z][\w.&-]*(?:\s+[A-Za-z][\w.&-]*){0,2})/i)
  const company = coRu ? coRu[1]! : coEn ? capitalizedRun(coEn[1]!) : ''
  if (company && !d.company && !seeking && !cityIn(company)) d.company = trimPunct(company)

  // city and moves
  const move = l.match(/(переезжа[а-яёa-z]*|переедет|собирается переехать|планирует переезд|релоцир[а-яёa-z]*)\s+(?:в|на)\s+([а-я-]+)/)
  const moveEn = move ? null : l.match(/\b(?:moving|relocating|moves|relocates|is moving|will move|plans to move|going to move|is relocating)\s+to\s+([a-z-]+(?:\s[a-z]+)?)/)
  const toCity = move ? cityKey(move[2]!) : moveEn ? cityKey(moveEn[1]!) : undefined
  if (toCity) {
    d.topics.push(t('How the move to {city} is going', { city: t(toCity) }))
    d.facts.push(t('Planning to move: {city}', { city: t(toCity) }))
  }
  const moved = l.match(/(?:переехал[а-яёa-z]*|живет|живёт|живут|из)\s+(?:в|на)?\s*([а-я-]+)/)
    ?? l.match(/\b(?:lives in|live in|living in|based in|moved to|is from|located in|relocated to|from)\s+([a-z-]+(?:\s[a-z]+)?)/)
  if (!d.city && moved && !toCity) d.city = cityIn(moved[1]!) ?? null
  if (!d.city && !toCity) {
    // English: "a designer in Berlin" — a known city after "in" / "from"
    for (const mm of l.matchAll(/\b(?:in|from)\s+([a-z-]+(?:\s[a-z]+)?)/g)) { const c = cityIn(mm[1]!); if (c) { d.city = c; break } }
  }

  // family
  const famRu = [...query.matchAll(FAMILY_RE_RU)]
  const famEn = famRu.length ? [] : [...query.matchAll(FAMILY_RE_EN)].filter(m => !m[2] || /^[A-Z]/.test(m[2]))
  const fam = [...famRu, ...famEn]
  if (fam.length) {
    const parts = fam.map(m => {
      const rel = FAMILY_WORDS[m[1]!.toLowerCase()] ?? m[1]!.toLowerCase()
      const age = m[3] ? `(${tn(Number(m[3]), '{n} year', '{n} years')})` : ''
      return [t(rel), m[2], age].filter(Boolean).join(' ')
    })
    d.family = cap([d.family, ...parts].filter(Boolean).join(', '))
  }

  // likes / hobbies
  for (const m of query.matchAll(/(?:любит|обожает|фанат[а-яёa-z]*|увлекается|занимается|играет в|играет на|коллекционирует)\s+([^,.;!?]+)/gi)) {
    const what = trimPunct(m[1]!)
    if (what && what.split(' ').length <= 6) {
      d.facts.push(cap(`${m[0].split(' ')[0]!.toLowerCase()} ${what}`))
      if (what.split(' ').length <= 2 && !/кофе|чай/.test(what)) d.interests.push(cap(what))
    }
  }
  for (const m of query.matchAll(/\b(loves?|enjoys?|likes|is into|is a fan of|plays|collects|is passionate about|is obsessed with)\s+([^,.;!?]+)/gi)) {
    const what = trimPunct(m[2]!.split(/\s+(?:and|but|while|although|though)\s+/)[0]!)
    if (what && what.split(' ').length <= 6) {
      d.facts.push(cap(`${m[1]!.toLowerCase()} ${what}`))
      if (what.split(' ').length <= 2 && !/^(coffee|tea)$/i.test(what)) d.interests.push(cap(what))
    }
  }
  if (/не пь[её]т|не ест|аллерги|веган|вегетариан|без глютена/i.test(query)) {
    const m = query.match(/(не пь[её]т[^,.;]*|не ест[^,.;]*|аллерги[^,.;]*|веган[а-яёa-z]*|вегетариан[а-яёa-z]*|без глютена)/i)
    if (m) d.facts.push(cap(trimPunct(m[1]!)))
  }
  const diet = query.match(/\b(doesn'?t drink[^,.;]*|does not drink[^,.;]*|doesn'?t eat[^,.;]*|does not eat[^,.;]*|allergic to[^,.;]*|has an? [a-z]+ allergy|vegan|vegetarian|gluten-free|no gluten|teetotal(?:ler)?)/i)
  if (diet) d.facts.push(cap(trimPunct(diet[1]!)))

  // looking for / needs
  const need = query.match(/(?:ищет|ищут|в поиске|хочет найти|нужен|нужна|нужно|нужны|не хватает)\s+([^,.;!?]+)/i)
    ?? query.match(/\b(?:is |are )?(?:looking for|looks for|seeking|searching for|in search of|wants to find|in need of|needs?)\s+([^,.;!?]+)/i)
  if (need && !d.looking_for) d.looking_for = cap(trimPunct(need[1]!.replace(/^(?:an?|the)\s+/i, '')))
  const intro = query.match(/хочет (?:интро|познакомиться|знакомство)\s+(?:к|с|со)\s+([А-ЯЁ][а-яё]+)/)
    ?? query.match(/\b(?:wants|would like|asked for|needs|hopes) (?:an? )?(?:intro(?:duction)?|to meet)\s+(?:to|with)\s+([A-Z][a-z]+)/)
  if (intro) {
    const target = findMentioned(intro[1]!, people)[0]
    const nm = target ? target.firstName : nameToNominative(intro[1]!)
    d.looking_for = d.looking_for ?? t('Introduction: {name}', { name: nm })
    d.i_can_help = d.i_can_help ? `${d.i_can_help}; ${t('intro: {name}', { name: nm })}` : t('Intro: {name}', { name: nm })
    reminders.push({ person_ref: d.ref, text: t('Intro: {from} → {to}', { from: selfName, to: nm }), due_date: toISODate(startOfDay(now) + 3 * DAY) })
  }
  const helps = query.match(/(?:может помочь|поможет|разбирается в|эксперт в|силён в|сильна в|шарит в)\s+([^.;!?]+)/i)
    ?? query.match(/\b(?:can help with|will help with|is an expert in|expert in|is strong in|strong in|is great at|specializes in|knows a lot about)\s+([^.;!?]+)/i)
  if (helps && !d.can_help) d.can_help = cap(trimPunct(helps[1]!))

  // plans → topics
  const PLAN: Record<string, string> = {
    запуска: msg('How the launch of {what} is going'), планиру: msg('How the plans are going: {what}'), собира: msg('How the plans are going: {what}'),
    готов: msg('How the preparation is going: {what}'), лет: msg('How the trip is going: {what}'), ед: msg('How the trip is going: {what}'),
    поступа: msg('How the admission is going: {what}'), выход: msg('How the release is going: {what}'),
  }
  for (const m of query.matchAll(/(запускает|запускают|планирует|собирается|готовит|летит|едет|поступает|выходит)\s+([^,.;!?]+)/gi)) {
    const what = trimPunct(m[2]!)
    const key = Object.keys(PLAN).find(k => m[1]!.toLowerCase().startsWith(k))
    if (what && key && !/переех|переезд/.test(what)) d.topics.push(cap(t(PLAN[key]!, { what })))
  }
  const PLAN_EN: Record<string, string> = {
    launch: msg('How the launch of {what} is going'), plan: msg('How the plans are going: {what}'), prepar: msg('How the preparation is going: {what}'),
    fl: msg('How the trip is going: {what}'), travel: msg('How the trip is going: {what}'), go: msg('How the trip is going: {what}'), apply: msg('How the admission is going: {what}'), releas: msg('How the release is going: {what}'),
  }
  for (const m of query.matchAll(/\b(is launching|launches|launching|is planning|plans|planning|is preparing|prepares|preparing|is flying to|flies to|is traveling to|travels to|is going to|is applying to|applies to|is releasing|releases)\s+([^,.;!?]+)/gi)) {
    const what = trimPunct(m[2]!)
    const verb = m[1]!.toLowerCase().replace(/^is /, '')
    const key = Object.keys(PLAN_EN).find(k => verb.startsWith(k))
    if (what && key && !/\b(move|moving|relocat)/i.test(what) && !/^to move\b/i.test(what)) d.topics.push(cap(t(PLAN_EN[key]!, { what })))
  }

  // birthday
  const b = parseBirthday(query)
  if (b) d.birthday = b

  // contacts
  const phone = query.match(/(\+?\d[\d\s()-]{8,}\d)/)
  if (phone && !d.channels.some(c => c.type === 'phone')) d.channels.push({ type: 'phone', value: phone[1]!.trim() })
  const email = query.match(/([\w.+-]+@[\w-]+\.[\w.]+)/)
  if (email) d.channels.push({ type: 'email', value: email[1]! })
  const tg = query.match(/(?:телеграм[а-яёa-z]*|telegram|тг|tg)\s*[:—-]?\s*@?([a-z0-9_]{4,})/i) ?? query.match(/(?<![\w.])@([a-z0-9_]{4,})(?![\w.@])/i)
  if (tg && !d.channels.some(c => c.type === 'telegram')) d.channels.push({ type: 'telegram', value: tg[1]! })
  const ig = query.match(/(?:инстаграм[а-яёa-z]*|instagram|инста)\s*[:—-]?\s*@?([a-z0-9_.]{3,})/i)
  if (ig) d.channels.push({ type: 'instagram', value: ig[1]! })

  // gifts
  const gift = query.match(/(?:мечтает о|хочет купить|хочет себе)\s+([^,.;!?]+)/i)
    ?? query.match(/\b(?:dreams? of|wants to buy|wants an?|wishes for|has been eyeing)\s+([^,.;!?]+)/i)
  if (gift) d.gift_ideas = cap(trimPunct(gift[1]!))

  // who introduced
  const via = query.match(/(?:через|познакомил[аи]?|представил[аи]?)\s+([А-ЯЁ][а-яё]+)/) ?? query.match(/(?:^|\s)у\s+([А-ЯЁ][а-яё]+)/)
    ?? query.match(/\b(?:introduced by|introduced (?:me|us|them) (?:to (?:him|her|them) )?(?:by|through)|met through|through|via|thanks to|courtesy of)\s+([A-Z][a-z]+)/i)
  if (via && !d.introduced_by_id) {
    const intro = findMentioned(via[1]!, people)[0]
    if (intro && intro.firstName !== d.first_name) d.introduced_by_id = intro.id
  }
}

/** Agreements → reminders. */
function extractAgreements(text: string, now: number, ref: string | null, who: string, whoInstr?: string) {
  const out: CapturePlan['reminders'] = []
  const query2 = text
  const agree = query2.match(/договорились\s+(созвониться|встретиться|списаться|увидеться|пообедать|поужинать|выпить кофе|обсудить[^,.;]*)([^.;!?]*)/i)
  if (agree) {
    const act = agree[1]!.toLowerCase()
    const base = act.replace('списаться', 'написать').replace('увидеться', 'встретиться')
    const verb = act.startsWith('обсудить') ? `${cap(act)} (${who})` : whoInstr ? cap(`${base} ${base.startsWith('написать') ? '' : 'с '}${base.startsWith('написать') ? who : whoInstr}`) : `${cap(base)} — ${who}`
    out.push({ person_ref: ref, text: verb, due_date: parseWhen(agree[2] + ' ' + query2, now) ?? toISODate(startOfDay(now) + 7 * DAY) })
  }
  const agreeEn = agree ? null : query2.match(/\b(?:agreed|decided|arranged|planned)\s+to\s+(call|meet|catch up|talk|speak|chat|connect|follow up|have (?:lunch|dinner|breakfast|coffee)|grab (?:lunch|dinner|coffee)|discuss[^,.;]*)([^.;!?]*)/i)
  if (agreeEn) {
    const act = agreeEn[1]!.toLowerCase()
    const label = act.startsWith('discuss') ? t('{topic} ({who})', { topic: cap(act), who })
      : act === 'call' ? t('Call {who}', { who })
      : act === 'meet' ? t('Meet {who}', { who })
      : act === 'catch up' ? t('Catch up with {who}', { who })
      : /^(talk|speak|chat)$/.test(act) ? t('Talk to {who}', { who })
      : act === 'connect' ? t('Connect with {who}', { who })
      : act === 'follow up' ? t('Follow up with {who}', { who })
      : /coffee/.test(act) ? t('Have coffee with {who}', { who })
      : /lunch/.test(act) ? t('Have lunch with {who}', { who })
      : t('Have dinner with {who}', { who })
    out.push({ person_ref: ref, text: label, due_date: parseWhen(agreeEn[2] + ' ' + query2, now) ?? toISODate(startOfDay(now) + 7 * DAY) })
  }
  for (const m of query2.matchAll(/(?:я\s+)?(?:обещал[а]?|пообещал[а]?|надо|нужно не забыть|не забыть)\s+([^.;!?]+)/gi)) {
    const what = trimPunct(m[1]!)
    if (what.length > 3 && !/созвон/.test(what)) out.push({ person_ref: ref, text: cap(what), due_date: parseWhen(what, now) ?? toISODate(startOfDay(now) + 3 * DAY) })
  }
  for (const m of query2.matchAll(/\b(?:I\s+)?(?:promised(?: to)?|(?:need|have) to|don'?t forget to|do not forget to|remember to)\s+([^.;!?]+)/gi)) {
    const what = trimPunct(m[1]!)
    if (what.length > 3 && !/\b(call|meet) (?:him|her|them)\b.*\bagreed\b/i.test(what)) out.push({ person_ref: ref, text: cap(what), due_date: parseWhen(what, now) ?? toISODate(startOfDay(now) + 3 * DAY) })
  }
  return out
}

function interactionType(value2: string): NonNullable<CapturePlan['interaction']>['type'] {
  if (/созвонил[а-яё]*|звонил[а-яё]*|по телефону|видеозвон|в зуме|zoom/i.test(value2.replace(/договорились[^.;]*/gi, ''))) return 'call'
  if (/\b(?:phone call|video call|had a call|on a call|called|google meet)\b|\bzoom\b/i.test(value2.replace(/\b(?:agreed|decided|arranged|planned) to[^.;]*/gi, ''))) return 'call'
  if (/переписк|написал[аи]? мне|в телеграме|в личке/i.test(value2)) return 'message'
  if (/\b(?:chatted|texted|messaged|exchanged messages|over email|on telegram|on whatsapp|via dm|in dms?)\b/i.test(value2)) return 'message'
  if (/конференц|митап|форум|summit|саммит|выставк|фестивал|хакатон|ивент|event/i.test(value2)) return 'event'
  if (/\b(?:conference|meetup|forum|expo|exhibition|festival|hackathon|trade show)\b/i.test(value2)) return 'event'
  return 'meeting'
}

function metPlace(value3: string, people: Person[]) {
  const m = value3.match(/(?:на|во время)\s+((?:ужин|обед|завтрак|кофе|конференци|встреч|вечеринк|митап|форум|выставк|презентаци|дне рождения|свадьб|хакатон|тренировк|пробежк)[^,.;!?]*)/i)
    ?? value3.match(/(?:^|\s)на\s+([A-Z][\w-]+(?:\s+[A-Z0-9][\w-]*)*)/)
  if (!m) return metPlaceEn(value3)
  void people
  const NOM: [RegExp, string][] = [
    [/^ужине/i, 'ужин'], [/^обеде/i, 'обед'], [/^завтраке/i, 'завтрак'], [/^конференции/i, 'конференция'], [/^встрече/i, 'встреча'],
    [/^вечеринке/i, 'вечеринка'], [/^митапе/i, 'митап'], [/^форуме/i, 'форум'], [/^выставке/i, 'выставка'], [/^презентации/i, 'презентация'],
    [/^дне рождения/i, 'день рождения'], [/^свадьбе/i, 'свадьба'], [/^хакатоне/i, 'хакатон'], [/^тренировке/i, 'тренировка'], [/^пробежке/i, 'пробежка'],
  ]
  let place = trimPunct(m[1]!.split(/\s[—–-]\s|\s(?:[Пп]ознакомил|[Вв]стретил|[Пп]ообщал|[Рр]азговорил|я\s|мы\s|он\s|она\s|они\s|с[о]?\s+[А-ЯЁ]|где\s|когда\s)/)[0]!)
  for (const [re, to] of NOM) if (re.test(place)) { place = place.replace(re, to); break }
  return place ? cap(place.length > 60 ? place.slice(0, 60) + '…' : place) : null
}

function metPlaceEn(value3: string) {
  const m = value3.match(/\b(?:at|during|over)\s+(?:an?\s+|the\s+|a\s+)?((?:dinner|lunch|breakfast|coffee|conference|meeting|party|meetup|forum|expo|exhibition|presentation|wedding|hackathon|workout|run|summit|festival|event|birthday)[^,.;!?]*)/i)
    ?? value3.match(/(?:^|\s)at\s+([A-Z][\w-]+(?:\s+[A-Z0-9][\w-]*)*)/)
  if (!m) return null
  const place = trimPunct(m[1]!.split(/\s[—–-]\s|\s(?:and\s+)?(?:we|he|she|they|I|met|talked|spoke|chatted|where|when)\s/)[0]!)
  return place ? cap(place.length > 60 ? place.slice(0, 60) + '…' : place) : null
}

/** Find the instrumental form of the name in the text: «с Марком». */
function instrumentalOf(src: string, name: string) {
  for (const m of src.matchAll(/(?:^|\s)с[о]?\s+([А-ЯЁ][а-яё]+)/g)) if (nameToNominative(m[1]!) === name || m[1] === name) return m[1]
  return undefined
}

/** Local parsing of a post-meeting note. */
export function localCapture(text: string, people: Person[], now = Date.now()): CapturePlan {
  const src = text.trim()
  const plan: CapturePlan = { summary: '', people: [], interaction: null, reminders: [] }
  if (!src) return plan

  const mentioned = findMentioned(src, people)
  const drafts: PersonDraft[] = []
  let refN = 1

  // new people: «познакомился с Артёмом Беловым», «зовут Катя», "met Katie Smith"
  const fresh: { first: string; last?: string; instr?: string }[] = []
  for (const re of [NAME_AFTER, NAMED, NAME_AFTER_EN, NAMED_EN]) {
    const m = src.match(re)
    if (!m) continue
    const latin = re === NAME_AFTER_EN || re === NAMED_EN
    if (latin && fresh.length) continue
    const first = latin ? m[1]! : nameToNominative(m[1]!)
    const last = m[2] && !/^(На|В|Из|И|У|По|О)$/.test(m[2]) && !(latin && STARTERS_EN.test(m[2])) ? (latin ? m[2] : surnameToNominative(m[2])) : undefined
    fresh.push({ first, last, instr: re === NAME_AFTER ? [m[1], m[2] && last ? m[2] : ''].filter(Boolean).join(' ') : undefined })
    if (m[3]) for (const extra of m[3].split(/,|\sи\s|\sand\s/).map(s => s.trim()).filter(Boolean)) fresh.push({ first: latin ? extra : nameToNominative(extra) })
  }

  // the note starts with a name: «Катя Смирнова, дизайнер в Spotify…»
  if (!fresh.length) {
    const lead = src.match(/^\s*([А-ЯЁ][а-яё]{1,})(?:\s+([А-ЯЁ][а-яё]{1,}))?(?=[\s,.—:-])/) ?? src.match(/^\s*([A-Z][a-z]{1,})(?:\s+([A-Z][a-z]{1,}))?(?=[\s,.—:-])/)
    const STARTERS = /^(Просто|Вообще|Короче|Тут|Там|Здесь|Потом|Затем|Тоже|Только|Сейчас|Недавно|Давно|Всё|Все|Много|Мало|Хорошо|Плохо|Надо|Можно|Важно|Спасибо|Привет|Здравствуйте|Добрый|Заметка|Напоминание|Идея|Итог|Итоги|Договорённость|Договоренность|Тема|План|Задача|Сегодня|Вчера|Утром|Вечером|Днём|Днем|На|В|Во|С|Со|У|Был|Была|Были|Очень|Он|Она|Они|Мы|Я|Это|Пили|Ужинали|Обедали|Созвонились|Встретились|Говорили|Обсудили|Договорились|Кстати|Также|Ещё|Еще|После|Перед|Когда|Если|Наконец|Познакомились|Познакомился|Познакомилась|Встретил|Встретила|Новый|Новая|Интересный|Интересная|Классный|Классная)$/
    const isStarter = (w: string) => STARTERS.test(w) || STARTERS_EN.test(w)
    const afterLead = lead ? src.slice(lead[0].length) : ''
    const looksLikeName = !!lead && (!!(lead[2] && !isStarter(lead[2])) || /^\s*[,—–:-]/.test(afterLead))
    // a namesake from the network ("Fyodor Novikov" next to a known "Fyodor Vetrov") is a different person
    const surname = lead?.[2] && !isStarter(lead[2]) ? lead[2] : undefined
    const known = lead ? findMentioned(lead[1]!, people) : []
    const sameSurname = (p: Person) => !surname || !p.lastName || lower(p.lastName).startsWith(lower(surname).slice(0, 4))
    if (lead && looksLikeName && !isStarter(lead[1]!) && !known.some(sameSurname)) {
      fresh.push({ first: lead[1]!, last: surname })
    }
  }

  const used = new Set<string>()
  for (const f of fresh) {
    const existing = people.find(p => !p.archived && personNameRe(p).test(lower(f.first)) && (!f.last || !p.lastName || lower(p.lastName).startsWith(lower(f.last).slice(0, 4))))
    if (existing) {
      if (used.has(existing.id)) continue
      used.add(existing.id)
      const d = blankDraft(`p${refN++}`, existing.firstName, existing.lastName)
      d.existing_id = existing.id
      drafts.push(d)
    } else {
      drafts.push(blankDraft(`p${refN++}`, cap(f.first), f.last ? cap(f.last) : undefined))
    }
  }
  // known people that are mentioned (when there is no explicit construction) — except those who only "introduced" or whom an "intro" is for
  if (!drafts.length) {
    const side = new Set<string>()
    for (const m of src.matchAll(/(?:(?:^|\s)у|через|интро\s+к|познакомиться\s+с|познакомить\s+с|знакомство\s+с)\s+([А-ЯЁ][а-яё]+)/g)) {
      const hit = findMentioned(m[1]!, people)[0]
      if (hit) side.add(hit.id)
    }
    for (const m of src.matchAll(/\b(?:via|through|introduced by|intro(?:duction)? to|introduce(?:d)? (?:me )?to|thanks to)\s+([A-Z][a-z]+)/gi)) {
      const hit = findMentioned(m[1]!, people)[0]
      if (hit) side.add(hit.id)
    }
    const generic = src.match(/(?:^|\s)с[о]?\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?/) ?? src.match(/(?:^|\s)(?:with|to)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/)
    const main = mentioned.filter(p => !side.has(p.id))
    if (!main.length && generic) {
      const hit = findMentioned(generic[1]!, people)[0]
      if (hit && !side.has(hit.id)) main.push(hit)
      else if (!hit) {
        drafts.push(blankDraft(`p${refN++}`, cap(nameToNominative(generic[1]!)), generic[2] ? cap(surnameToNominative(generic[2])) : undefined))
      }
    }
    for (const p of main.slice(0, 3)) {
      const d = blankDraft(`p${refN++}`, p.firstName, p.lastName)
      d.existing_id = p.id
      drafts.push(d)
    }
  }
  if (!drafts.length) {
    plan.summary = t("Couldn't find a name — I'll save it as a note. Start with “Met …” or name the person.")
    return plan
  }

  const main = drafts[0]!
  const reminders: CapturePlan['reminders'] = []
  // every clause belongs to the main person, unless another acquaintance is named explicitly
  for (const c of clauses(src)) {
    const other = drafts.slice(1).find(d => personNameRe({ firstName: d.first_name }).test(lower(c)))
    extractInto(other ?? main, c, people.filter(p => p.id !== (other ?? main).existing_id), now, reminders, main.first_name)
  }
  const place = metPlace(src, people)
  for (const d of drafts) {
    if (!d.existing_id) d.met_place = place
    d.facts = [...new Set(d.facts)].slice(0, 6)
    d.interests = [...new Set(d.interests)].slice(0, 6)
    d.topics = [...new Set(d.topics)].slice(0, 4)
    // don't confuse "who introduced" with the person themself
    if (d.introduced_by_id && d.existing_id === d.introduced_by_id) d.introduced_by_id = null
  }

  plan.people = drafts
  const instr = fresh.find(f => f.first === main.first_name)?.instr ?? instrumentalOf(src, main.first_name)
  plan.reminders = [...reminders, ...extractAgreements(src, now, main.ref, main.first_name, instr)]
    .filter((r, i, a) => a.findIndex(x => x.text === r.text) === i)
  const type = interactionType(src)
  const single = instr ?? (/^[A-Za-z]/.test(main.first_name) ? main.first_name : undefined)
  const names = drafts.slice(0, 3).map(d => d.first_name).join(', ')
  plan.interaction = {
    type,
    title: place ?? (single && drafts.length === 1
      ? (type === 'call' ? t('Call with {name}', { name: single.split(' ')[0]! }) : main.existing_id ? t('Meeting with {name}', { name: single.split(' ')[0]! }) : t('Getting to know {name}', { name: single.split(' ')[0]! }))
      : (type === 'call' ? t('Call: {names}', { names }) : main.existing_id ? t('Meeting: {names}', { names }) : t('Getting to know: {names}', { names }))),
    summary: src.length > 400 ? src.slice(0, 400) + '…' : src,
    place,
    person_refs: drafts.map(d => d.ref),
  }
  const newOnes = drafts.filter(d => !d.existing_id).map(d => d.first_name)
  const known = drafts.filter(d => d.existing_id).map(d => d.first_name)
  plan.summary = [
    newOnes.length ? t('New acquaintance: {names}', { names: newOnes.join(', ') }) : '',
    known.length ? (newOnes.length ? t('and a meeting: {names}', { names: known.join(', ') }) : t('Meeting: {names}', { names: known.join(', ') })) : '',
    plan.reminders.length ? tn(plan.reminders.length, '· {n} reminder', '· {n} reminders') : '',
  ].filter(Boolean).join(' ')
  return plan
}

/** Local suggestions from a note about a specific person. */
export function localNoteSuggest(text: string, person: Person, people: Person[], now = Date.now()): NoteSuggestions {
  const items: NoteSuggestions['items'] = []
  if (text.trim().length < 6) return { items }
  const d = blankDraft('p1', person.firstName, person.lastName)
  const rems: CapturePlan['reminders'] = []
  for (const c of clauses(text)) extractInto(d, c, people.filter(p => p.id !== person.id), now, rems, person.firstName)
  for (const r of [...rems, ...extractAgreements(text, now, 'p1', person.firstName)]) items.push({ kind: 'reminder', text: r.text, due_date: r.due_date })
  // single reminders: "call back after the vacation in August"
  const when = text.match(/(перезвонить|позвонить|написать|напомнить|отправить|скинуть|прислать|встретиться|поздравить)([^.;!?]*)/i)
    ?? text.match(/\b(call back|call|write|message|text|remind|send|email|follow up|meet|catch up|congratulate)\b([^.;!?]*)/i)
  if (when && !items.some(i => i.kind === 'reminder')) {
    const due = parseWhen(when[0], now)
    if (due) items.push({ kind: 'reminder', text: cap(trimPunct(when[0])), due_date: due })
  }
  if (d.family && d.family !== person.family) items.push({ kind: 'family', text: d.family, due_date: null })
  for (const f of d.facts) if (!person.facts.some(x => lower(x.text) === lower(f))) items.push({ kind: 'fact', text: f, due_date: null })
  for (const tp of d.topics) if (!person.topics.some(x => lower(x.text) === lower(tp))) items.push({ kind: 'topic', text: tp, due_date: null })
  if (d.looking_for && d.looking_for !== person.lookingFor) items.push({ kind: 'looking_for', text: d.looking_for, due_date: null })
  if (d.can_help && d.can_help !== person.canHelpMe) items.push({ kind: 'can_help', text: d.can_help, due_date: null })
  if (d.birthday && d.birthday !== person.birthday) items.push({ kind: 'birthday', text: t('Birthday'), due_date: d.birthday })
  for (const i of d.interests) if (!person.tags.includes(i)) items.push({ kind: 'interest', text: i, due_date: null })
  if (d.gift_ideas && d.gift_ideas !== person.giftIdeas) items.push({ kind: 'gift', text: d.gift_ideas, due_date: null })
  const seen = new Set<string>()
  return { items: items.filter(i => { const k = i.kind + lower(i.text); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 5) }
}

export { wordRe }
