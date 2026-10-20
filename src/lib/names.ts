/**
 * Names across scripts: "Alexey" finds "Алексей", "Саша" finds "Александр", "Bob" finds "Robert".
 *
 * Idea: every name is reduced to a "skeleton" — a simplified Latin spelling by sound. Cyrillic and Latin spellings
 * of the same name give the same skeleton. On top of that come groups of diminutives (Саша ↔ Александр ↔ Alex, Bob ↔ Robert).
 * Search works in either script regardless of the interface language.
 */

const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** Lower case, ё→е, no punctuation or diacritics (é → e). */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const isCyrillic = (s: string) => /[а-я]/.test(s)

function translit(s: string): string {
  let out = ''
  for (const ch of s) out += RU[ch] ?? ch
  return out
}

/** Brings a Latin spelling to one form: Alexei, Aleksey and Alexey are the same. */
function canonLatin(raw: string): string {
  let s = raw
  s = s.replace(/shch|sch/g, 'shch').replace(/tch/g, 'ch').replace(/ph/g, 'f').replace(/kh/g, 'h').replace(/tz/g, 'ts')
  s = s.replace(/ju/g, 'yu').replace(/ja/g, 'ya').replace(/jo/g, 'yo').replace(/iu/g, 'yu').replace(/iya/g, 'ya').replace(/ia/g, 'ya')
  s = s.replace(/x/g, 'ks').replace(/c(?=[eiy])/g, 's').replace(/ck/g, 'k').replace(/c/g, 'k').replace(/q/g, 'k').replace(/w/g, 'v').replace(/j/g, 'y')
  s = s.replace(/^ye/, 'e').replace(/yo/g, 'e')
  s = s.replace(/(iy|ii|yi|yy)$/, 'y').replace(/(ei|ey)$/, 'ey').replace(/i$/, 'y')
  s = s.replace(/(.)\1+/g, '$1') // doubled letters: Anna → ana
  return s
}

/** Phonetic skeleton of a word. Cyrillic and Latin spellings of the same name coincide. */
export function skeleton(word: string): string {
  const n = normalize(word).replace(/\s/g, '')
  return canonLatin(isCyrillic(n) ? translit(n) : n)
}

const consonants = (sk: string) => sk.replace(/[aeiouy]/g, '')

/** Groups of one name: full form, diminutives, variants in other languages. */
const GROUPS: string[][] = [
  ['александр', 'александра', 'саша', 'шура', 'санёк', 'саня', 'алекс', 'alex', 'alexander', 'alexandra', 'sasha', 'sanya', 'sandra'],
  ['алексей', 'алёша', 'лёша', 'леша', 'алёшка', 'alexey', 'alexei', 'aleksey', 'alex', 'lyosha'],
  ['евгений', 'евгения', 'женя', 'жека', 'evgeny', 'eugene', 'zhenya', 'evgenia', 'eugenia'],
  ['дмитрий', 'дима', 'митя', 'dmitry', 'dmitri', 'dima', 'mitya'],
  ['михаил', 'миша', 'мишаня', 'michael', 'mikhail', 'mike', 'misha'],
  ['николай', 'коля', 'никола', 'nikolay', 'nicholas', 'nick', 'kolya', 'nikolai'],
  ['сергей', 'серёжа', 'серёга', 'сережа', 'sergey', 'sergei', 'serge', 'seryozha'],
  ['андрей', 'андрюша', 'андрюха', 'andrey', 'andrei', 'andrew', 'andy'],
  ['владимир', 'вова', 'володя', 'вовка', 'vladimir', 'vova', 'volodya'],
  ['виктор', 'витя', 'виктория', 'вика', 'victor', 'viktor', 'vitya', 'victoria', 'viktoria', 'vika'],
  ['иван', 'ваня', 'ванька', 'ivan', 'vanya', 'john'],
  ['пётр', 'петр', 'петя', 'peter', 'pyotr', 'petr', 'petya'],
  ['павел', 'паша', 'pavel', 'paul', 'pasha'],
  ['григорий', 'гриша', 'grigory', 'gregory', 'grisha', 'greg'],
  ['максим', 'макс', 'максимилиан', 'maxim', 'max', 'maksim'],
  ['артём', 'артем', 'тёма', 'тема', 'artem', 'artyom', 'tyoma'],
  ['антон', 'тоша', 'anton', 'tony', 'tosha'],
  ['игорь', 'игорёк', 'igor'],
  ['олег', 'oleg'],
  ['роман', 'рома', 'roman', 'roma'],
  ['илья', 'илюша', 'ilya', 'ilia', 'elijah'],
  ['юрий', 'юра', 'yuri', 'yury', 'yuriy', 'george', 'yura'],
  ['георгий', 'жора', 'гоша', 'george', 'georgy', 'zhora', 'gosha'],
  ['борис', 'боря', 'boris', 'borya'],
  ['вячеслав', 'слава', 'vyacheslav', 'slava'],
  ['ярослав', 'ярик', 'yaroslav'],
  ['святослав', 'svyatoslav'],
  ['константин', 'костя', 'konstantin', 'kostya', 'constantine'],
  ['тимофей', 'тимоха', 'тима', 'timofey', 'timothy', 'tim', 'tima'],
  ['тимур', 'timur'],
  ['денис', 'деня', 'denis', 'dennis'],
  ['кирилл', 'кира', 'kirill', 'cyril'],
  ['фёдор', 'федор', 'федя', 'fedor', 'fyodor', 'theodore'],
  ['егор', 'егорка', 'yegor', 'egor'],
  ['руслан', 'ruslan'],
  ['станислав', 'стас', 'stanislav', 'stas'],
  ['даниил', 'данил', 'даниэль', 'даня', 'daniil', 'daniel', 'danil', 'danya'],
  ['леонид', 'лёня', 'леня', 'leonid', 'leo', 'lenya'],
  ['вадим', 'вадик', 'vadim'],
  ['валентин', 'валентина', 'валя', 'valentin', 'valentina', 'valya'],
  ['елена', 'лена', 'алёна', 'алена', 'елена', 'helen', 'elena', 'lena', 'alyona', 'alena'],
  ['екатерина', 'катя', 'катерина', 'катюша', 'ekaterina', 'katya', 'catherine', 'kate', 'katherine', 'yekaterina'],
  ['анна', 'аня', 'анюта', 'анька', 'anna', 'anya', 'ann', 'anne'],
  ['мария', 'маша', 'маруся', 'машенька', 'maria', 'masha', 'mary', 'marya', 'marie'],
  ['наталья', 'наталия', 'наташа', 'ната', 'natalia', 'natalya', 'natasha', 'natalie'],
  ['ольга', 'оля', 'olga', 'olya'],
  ['татьяна', 'таня', 'tatiana', 'tatyana', 'tanya'],
  ['светлана', 'света', 'svetlana', 'sveta'],
  ['юлия', 'юля', 'yulia', 'julia', 'yuliya', 'julie', 'yulya'],
  ['анастасия', 'настя', 'настенька', 'anastasia', 'anastasiya', 'nastya', 'stacy'],
  ['дарья', 'даша', 'darya', 'daria', 'dasha', 'dasha'],
  ['елизавета', 'лиза', 'лизавета', 'elizaveta', 'elizabeth', 'liza', 'lisa', 'beth'],
  ['ирина', 'ира', 'ирочка', 'irina', 'ira', 'irene'],
  ['людмила', 'люда', 'люся', 'lyudmila', 'ludmila', 'luda'],
  ['галина', 'галя', 'galina', 'galya'],
  ['надежда', 'надя', 'nadezhda', 'nadya', 'hope'],
  ['софья', 'софия', 'соня', 'sofia', 'sofya', 'sonya', 'sophie', 'sophia'],
  ['полина', 'поля', 'polina', 'paulina'],
  ['ксения', 'ксюша', 'ksenia', 'xenia', 'ksyusha'],
  ['вера', 'верочка', 'vera', 'faith'],
  ['любовь', 'люба', 'lyubov', 'luba'],
  ['марина', 'мариша', 'marina'],
  ['алина', 'alina', 'alinka'],
  ['ева', 'eva', 'eve'],
  ['нина', 'nina'],
  ['тамара', 'тома', 'tamara'],
  ['аркадий', 'аркаша', 'arkady', 'arkadiy', 'arkasha'],
  ['семён', 'семен', 'сеня', 'semyon', 'semen', 'simon', 'senya'],
  ['матвей', 'матюша', 'matvey', 'matthew', 'matt', 'matvei'],
  ['глеб', 'gleb'],
  ['лев', 'лёва', 'лева', 'lev', 'leo', 'lyova'],
  ['марк', 'mark', 'marcus'],
  ['степан', 'стёпа', 'степа', 'stepan', 'stephen', 'steve', 'styopa'],
  ['тихон', 'tikhon'],
  ['robert', 'rob', 'bob', 'bobby', 'роберт', 'боб', 'роб'],
  ['william', 'will', 'bill', 'billy', 'liam', 'вильям', 'уильям', 'билл', 'вилли'],
  ['james', 'jim', 'jimmy', 'jamie', 'джеймс', 'джим'],
  ['richard', 'rick', 'ricky', 'dick', 'ричард', 'рик'],
  ['thomas', 'tom', 'tommy', 'томас', 'том'],
  ['charles', 'charlie', 'chuck', 'чарльз', 'чарли'],
  ['edward', 'ed', 'eddie', 'ted', 'эдвард', 'эдди'],
  ['joseph', 'joe', 'joey', 'джозеф', 'джо', 'иосиф', 'осип'],
  ['henry', 'harry', 'hank', 'генри', 'гарри'],
  ['david', 'dave', 'davy', 'дэвид', 'дейв', 'давид', 'дава'],
  ['jonathan', 'jon', 'jonny', 'jack', 'johnny', 'джонатан', 'джон', 'джек'],
  ['christopher', 'chris', 'kit', 'кристофер', 'крис'],
  ['christina', 'kristina', 'christine', 'chris', 'кристина', 'кристин', 'крис'],
  ['samuel', 'sam', 'sammy', 'сэмюэл', 'сэм', 'самуил'],
  ['samantha', 'sam', 'саманта'],
  ['benjamin', 'ben', 'benny', 'бенджамин', 'бен', 'вениамин'],
  ['nathan', 'nathaniel', 'nate', 'нэйтан', 'натан', 'нейтан'],
  ['joshua', 'josh', 'джошуа', 'джош'],
  ['jacob', 'jake', 'яков', 'яша', 'джейкоб', 'джейк'],
  ['lawrence', 'laurence', 'larry', 'лоренс', 'ларри', 'лаврентий'],
  ['vincent', 'vince', 'винсент', 'винс', 'винсен'],
  ['jennifer', 'jen', 'jenny', 'дженнифер', 'дженни'],
  ['jessica', 'jess', 'jessie', 'джессика', 'джесс'],
  ['susan', 'sue', 'suzy', 'susie', 'сьюзан', 'сью', 'сюзанна', 'сюзи'],
  ['margaret', 'maggie', 'meg', 'peggy', 'маргарет', 'мэгги', 'маргарита', 'рита'],
  ['patricia', 'pat', 'patty', 'trish', 'патриция', 'пэт', 'пэтти'],
  ['barbara', 'barb', 'barbie', 'барбара', 'барби', 'варвара', 'варя'],
  ['deborah', 'debra', 'debbie', 'дебора', 'дебби'],
  ['rebecca', 'becky', 'ребекка', 'бекки'],
  ['emily', 'emilie', 'emmy', 'эмили', 'эмми'],
  ['amanda', 'mandy', 'аманда', 'мэнди'],
  ['stephanie', 'steph', 'стефани', 'стефания', 'стеша'],
]

/** word skeleton → group numbers (by the full skeleton and by consonants: Alexander ↔ Александр) */
const GROUP_INDEX = (() => {
  const full = new Map<string, Set<number>>()
  const cons = new Map<string, Set<number>>()
  GROUPS.forEach((g, i) => {
    for (const name of g) {
      const sk = skeleton(name)
      full.set(sk, (full.get(sk) ?? new Set()).add(i))
      const c = consonants(sk)
      if (c.length >= 3) cons.set(c, (cons.get(c) ?? new Set()).add(i))
    }
  })
  return { full, cons }
})()

function groupsOf(word: string): Set<number> {
  const sk = skeleton(word)
  const out = new Set<number>(GROUP_INDEX.full.get(sk) ?? [])
  const c = consonants(sk)
  if (c.length >= 4) for (const g of GROUP_INDEX.cons.get(c) ?? []) out.add(g)
  return out
}

/** All forms of a name: the name itself and the rest of its group — for hints and text search. */
export function nameVariants(word: string): string[] {
  const out = new Set<string>([normalize(word)])
  for (const g of groupsOf(word)) for (const v of GROUPS[g]!) out.add(normalize(v))
  return [...out].filter(Boolean)
}

export interface NamePerson { firstName: string; lastName?: string; nickname?: string }

const tokensOf = (p: NamePerson) => [p.firstName, p.lastName, p.nickname].flatMap(x => (x ? normalize(x).split(' ') : [])).filter(Boolean)

/** How well a query word matches a name word: 0 — not at all, up to 100 — exact. */
function tokenScore(q: string, value: string, qSk: string, tSk: string, qGroups: Set<number>, tGroups: Set<number>): number {
  if (q === value) return 100
  if (value.startsWith(q)) return 85
  if (qSk === tSk) return 90
  if (qSk.length >= 2 && tSk.startsWith(qSk)) return 72
  for (const g of qGroups) if (tGroups.has(g)) return 80
  const qc = consonants(qSk)
  if (qc.length >= 3 && qc === consonants(tSk) && qSk[0] === tSk[0]) return 55
  return 0
}

/** Score of a query against a person's name (every query word must be found). 0 — no match. */
export function nameScore(query: string, p: NamePerson): number {
  const qs = normalize(query).split(' ').filter(Boolean)
  if (!qs.length) return 0
  const ts = tokensOf(p)
  if (!ts.length) return 0
  const tInfo = ts.map(item => ({ t: item, sk: skeleton(item), g: groupsOf(item) }))
  let total = 0
  for (const q of qs) {
    const qSk = skeleton(q)
    const qG = qSk.length >= 2 ? groupsOf(q) : new Set<number>()
    let best = 0
    for (const x of tInfo) best = Math.max(best, tokenScore(q, x.t, qSk, x.sk, qG, x.g))
    if (!best) return 0
    total += best
  }
  return Math.round(total / qs.length)
}

/** People matching the query by name, best first. */
export function searchByName<T extends NamePerson>(query: string, people: T[]): T[] {
  return people
    .map(p => ({ p, s: nameScore(query, p) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.p)
}
