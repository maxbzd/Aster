import { msg } from '@/i18n'

/*
 * What the on-device engine knows beyond English and Russian: Spanish, German, French, Portuguese and Ukrainian.
 * It is data in the same shape as the English/Russian tables in parse.ts, kept apart so each language can be reviewed
 * (and a new one added) in one place. The measure is tests/ai/extraction.corpus.ts. A model on the device would cover
 * far more (see docs/NEURAL.md); this is the part that needs no download.
 *
 * Words are written without accents where a text may drop them, and always compared case-insensitively.
 */

/** Letters of the Latin alphabets of these languages. */
const UP = 'A-ZÀ-ÖØ-Þ'
const LO = 'a-zß-öø-ÿ'
const NAME = `([${UP}][${LO}'’-]+)(?:\\s+([${UP}][${LO}'’-]+))?`

/** "Conocí a Ana Walker", "J'ai croisé Omar Haddad", "Almocei com o Marcos Lee": the name that follows the verb of meeting. */
export const NAME_AFTER_ROMANCE = new RegExp(
  '(?:' +
    // Spanish
    "conoc[ií]\\s+a|almorc[eé]\\s+con|cen[eé]\\s+con|habl[eé]\\s+con|convers[eé]\\s+con|charl[eé]\\s+con|me\\s+reun[ií]\\s+con|llam[eé]\\s+a|me\\s+encontr[eé]\\s+con|tom[eé]\\s+(?:un\\s+)?caf[eé]\\s+con|caf[eé]\\s+con|qued[eé]\\s+con|me\\s+presentaron\\s+a|me\\s+present[oó]\\s+a|" +
    // French
    "j['’]ai\\s+(?:(?:rencontr|crois|appel)[eé]|vu|(?:d[eé]jeun|d[iî]n|discut|parl|retrouv)[eé]\\s+avec)|d[eé]jeuner\\s+avec|d[iî]ner\\s+avec|discussion\\s+avec|rendez-vous\\s+avec|appel\\s+avec|rencontre\\s+avec|caf[eé]\\s+avec|[eé]chang[eé]\\s+avec|discut[eé]\\s+avec|" +
    // Portuguese
    'conheci\\s+(?:a|o)|tomei\\s+(?:um\\s+)?caf[eé]\\s+com|almocei\\s+com|falei\\s+com|reuni[aã]o\\s+com|liguei\\s+para|encontrei|caf[eé]\\s+com|jantei\\s+com' +
    `)\\s+(?:(?:o|a)\\s+)?${NAME}`,
  'iu',
)

/** German puts the name before the verb ("Lena Fischer kennengelernt") or after "mit" ("Treffen mit Tom Brandt"). */
export const NAME_AFTER_DE = new RegExp(
  `(?:(?:Mittagessen|Abendessen|Gespr[aä]ch|Treffen|Telefonat|Kaffee|Termin|Anruf)\\s+mit\\s+)${NAME}`,
  'u',
)
export const NAME_BEFORE_DE = new RegExp(
  `(?<![${UP}${LO}])(?!(?:Zuf[aä]llig|Heute|Gestern|Neulich|K[uü]rzlich|Vorhin|Gerade|Dann|Danach|Sp[aä]ter|Ich|Wir|Er|Sie)\\s)([${UP}][${LO}'’-]+)\\s+([${UP}][${LO}'’-]+)(?:\\s+[^\\s.!?,;]+){0,4}?\\s+(?:getroffen|kennengelernt|angerufen|gesehen|gesprochen|besucht|begegnet)`,
  'u',
)

/** Ukrainian names come in the case the verb asks for ("з Анною", "Юлії"). */
export const NAME_AFTER_UK = new RegExp(
  // verb stems without the ending of gender and tense ("познайоми" + "вся" / "лася" / "лась"), then "з" / "із" / "зі"
  "(?:(?:познайоми|пообіда|повечеря|вечеря|поговор|поспілкува|зустр|перетн|розмовля|подзвон|передзвон|обіда)[а-яіїєґ'’]*\\s+(?:(?:з|із|зі)\\s+)?|(?:кава|обід|вечеря)\\s+(?:з|із|зі)\\s+)" +
    "([А-ЯІЇЄҐ][а-яіїєґ'’]+)(?:\\s+([А-ЯІЇЄҐ][а-яіїєґ'’]+))?",
  'iu',
)

/** Back to the base form: Анною → Анна, Маркусом → Маркус, Юлії → Юлія, Ноєм → Ной. */
export function ukNameToNominative(word: string): string {
  const rules: Array<[RegExp, string]> = [[/ією$/, 'ія'], [/ії$/, 'ія'], [/([жчшщ])ею$/, '$1а'], [/ею$/, 'я'], [/ою$/, 'а'], [/єм$/, 'й'], [/ом$/, ''], [/ем$/, '']]
  for (const [re, to] of rules) if (re.test(word)) return word.replace(re, to)
  return word
}

/** More specific first: the table is searched in order and the first match wins. They go in front of the English and Russian ones. */
export const ROLES_MORE: Array<[RegExp, string]> = [
  [/directora? t[eé]cnic[oa]|directeur technique|directrice technique|technische[rn]? leiter(?:in)?|technischer direktor|diretor[a]? t[eé]cnic[oa]|технічн[а-яіїєґ]* директор/i, msg('CTO')],
  [/director[a]? ejecutiv[oa]|consejer[oa] delegad[oa]|gesch[aä]ftsf[uü]hrer(?:in)?|vorstandsvorsitzende[rn]?|directeur g[eé]n[eé]ral|directrice g[eé]n[eé]rale|diretor[a]? executiv[oa]|diretor[a]?-geral/i, msg('CEO')],
  [/inversor[a]? [aá]ngel|business[ -]angel|investidor[a]?[ -]anjo|б[іi]знес-ангел/i, msg('Angel investor')],
  [/gerente de producto|produktmanager(?:in)?|chef(?:fe)? de produit|gerente de produto|продакт-менеджер/i, msg('Product Manager')],
  [/arquitect[oa]|architekt(?:in)?|architecte|arquitet[oa]|архітектор/i, msg('Architect')],
  [/fot[oó]graf[oa]|fotograf(?:in)?(?![a-zа-я])|photographe|фотограф(?:иня)?/i, msg('Photographer')],
  [/abogad[oa]|anw[aä]lt(?:in)?|anwalt|avocat(?:e)?|advogad[oa]|юристк[аи]|юрист/i, msg('Lawyer')],
  [/reclutador(?:a)?|recruiter(?:in)?|recruteu(?:r|se)|recrutador(?:a)?|рекрутер/i, msg('Recruiter')],
]

export const INDUSTRIES_MORE: Array<[RegExp, string]> = [
  [/inmobiliari[oa]|immobilien|immobilier|imobili[aá]ri[oa]|нерухом/i, msg('Real estate')],
  [/фінтех/i, msg('Fintech')],
  [/cripto(?!g)|krypto|кріпто|крипто/i, msg('Crypto')],
  [/log[ií]stic[ao]|logistik|logistique|логістик|логістичн/i, msg('Logistics')],
  // `\b` does not see accented letters either, hence the lookarounds around "santé"
  [/\bsalud\b|gesundheit|(?<![a-zà-ÿ])sant[eé](?![a-zà-ÿ])|\bsa[uú]de\b|медичн|охорон[аиу] здоров/i, msg('Healthtech')],
  [/aprendizaje autom[aá]tico|maschinelle[mnrs]? lernen|apprentissage automatique|aprendizado de m[aá]quina|aprendizagem autom[aá]tica|inteligencia artificial|k[uü]nstliche intelligenz|intelligence artificielle|intelig[eê]ncia artificial|нейромереж|машинн[а-яіїєґ]* навчан/i, msg('AI')],
  [/videojuegos|videospiele|jeux vid[eé]o|videogames|videojogos|відеоігр|геймдев/i, msg('Gamedev')],
]

/** City names that differ between languages. They are compared with the lower-cased word. */
export const CITIES_MORE: Array<[RegExp, string]> = [
  [/berl[ií]n|berlim|берлін/, msg('Berlin')],
  [/lisboa|lissabon|lisbonne|лісабон/, msg('Lisbon')],
  [/londres|londra|лондон/, msg('London')],
  [/[aá]msterdam|amsterd[aã]|амстердам/, msg('Amsterdam')],
  [/dub[aá]i|dubaï|дубаї|дубай/, msg('Dubai')],
  [/(?<![a-zа-я])viena|(?<![a-z])wien|vienne|відн(?:я|і|ю|ем)|(?<![а-яіїєґ])відень/, msg('Vienna')],
  [/singapur|singapour|singapura|сінгапур/, msg('Singapore')],
  [/madrid|madri(?![a-z])|мадрид/, msg('Madrid')],
  [/bruxelles|bruselas|br[uü]ssel|bruxelas|брюссел/, msg('Brussels')],
  [/mil[aá]n(?![a-z])|mailand|mil[aã]o|мілан/, msg('Milan')],
  [/(?<![a-z])roma(?![a-z])|(?<![a-z])rome(?![a-z])|(?<![а-яіїєґ])рим(?![а-яіїєґ])/, msg('Rome')],
  [/praga|prag(?![a-z])|prague|прага|празі/, msg('Prague')],
  [/varsovia|warschau|varsovie|vars[oó]via|варшав/, msg('Warsaw')],
  [/estambul|constantinopla|стамбул/, msg('Istanbul')],
  [/ginebra|genf|gen[eè]ve|genebra|женев/, msg('Geneva')],
  [/z[uú]rich|zürich|zurique|цюрих/, msg('Zurich')],
  [/copenhague|kopenhagen|copenhaga|копенгаген/, msg('Copenhagen')],
  [/estocolmo|stockholm|стокгольм/, msg('Stockholm')],
  [/atenas|athen|ath[eè]nes|афін/, msg('Athens')],
]

/** Words in front of a city in these languages ("en", "à", "aus", "em", "у"); the name that follows is looked up. */
export const CITY_AFTER = /(?<![\p{L}])(?:en|em|na|no|à|au|aux|a|in|im|aus|von|de|du|da|do|dans|desde|у|в|во|із|з|від|біля)\s+(\p{Lu}[\p{L}'’-]+)/gu
