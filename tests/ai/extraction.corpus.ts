/**
 * A small multilingual corpus for the part of Astra that turns a note into a person card: who, role, city, field.
 * Each note is natural text in its language; `want` is what a person would read out of it, with labels from the
 * app's own vocabulary (the English label, as the code keys them). The scoring (`scoreExtractor`) works with any
 * extractor, so the regex engine and a future neural one are measured by the same yardstick.
 */
export type Lang = 'en' | 'ru' | 'es' | 'de' | 'fr' | 'pt' | 'uk'

export interface Gold {
  lang: Lang
  text: string
  /** the first name the card should be made for */
  first: string
  role: string
  city: string
  /** an interest/industry tag */
  field: string
}

export const CORPUS: Gold[] = [
  // English
  { lang: 'en', text: 'Met Anna Walker for coffee. She is CTO at a fintech startup in Berlin.', first: 'Anna', role: 'CTO', city: 'Berlin', field: 'Fintech' },
  { lang: 'en', text: 'Had lunch with Marcus Lee, an architect from Lisbon. He cares about real estate.', first: 'Marcus', role: 'Architect', city: 'Lisbon', field: 'Real estate' },
  { lang: 'en', text: 'Talked to Priya Nair, a photographer in London who works on crypto events.', first: 'Priya', role: 'Photographer', city: 'London', field: 'Crypto' },
  { lang: 'en', text: 'Met Tom Brandt, the CEO of a logistics company in Rotterdam. Based in Amsterdam now.', first: 'Tom', role: 'CEO', city: 'Amsterdam', field: 'Logistics' },
  { lang: 'en', text: 'Spoke with Julia Costa, a lawyer in Madrid, mostly about healthcare startups.', first: 'Julia', role: 'Lawyer', city: 'Madrid', field: 'Healthtech' },
  { lang: 'en', text: 'Caught up with Omar Haddad, product manager in Dubai, into machine learning.', first: 'Omar', role: 'Product Manager', city: 'Dubai', field: 'AI' },
  { lang: 'en', text: 'Met Lena Fischer, a recruiter from Vienna, interested in gaming.', first: 'Lena', role: 'Recruiter', city: 'Vienna', field: 'Gamedev' },
  { lang: 'en', text: 'Coffee with Noah Kim, angel investor in Singapore. Likes SaaS.', first: 'Noah', role: 'Angel investor', city: 'Singapore', field: 'SaaS' },
  // Russian
  { lang: 'ru', text: 'Познакомился с Анной Волковой на кофе. Она технический директор финтех-стартапа в Берлине.', first: 'Анна', role: 'CTO', city: 'Berlin', field: 'Fintech' },
  { lang: 'ru', text: 'Пообедал с Маркусом Ли, архитектором из Лиссабона. Интересуется недвижимостью.', first: 'Маркус', role: 'Architect', city: 'Lisbon', field: 'Real estate' },
  { lang: 'ru', text: 'Поговорил с Прией Наир, фотографом из Лондона, снимает крипто-конференции.', first: 'Прия', role: 'Photographer', city: 'London', field: 'Crypto' },
  { lang: 'ru', text: 'Встретился с Томом Брандтом, генеральным директором логистической компании. Теперь живёт в Амстердаме.', first: 'Том', role: 'CEO', city: 'Amsterdam', field: 'Logistics' },
  { lang: 'ru', text: 'Созвонился с Юлией Коста, юристом из Мадрида, говорили про медицину и стартапы.', first: 'Юлия', role: 'Lawyer', city: 'Madrid', field: 'Healthtech' },
  { lang: 'ru', text: 'Пересеклись с Омаром Хаддадом, продакт-менеджером в Дубае, увлекается нейросетями.', first: 'Омар', role: 'Product Manager', city: 'Dubai', field: 'AI' },
  { lang: 'ru', text: 'Познакомился с Леной Фишер, рекрутером из Вены. Любит геймдев.', first: 'Лена', role: 'Recruiter', city: 'Vienna', field: 'Gamedev' },
  { lang: 'ru', text: 'Кофе с Ноа Ким, бизнес-ангелом из Сингапура. Интересуется saas.', first: 'Ноа', role: 'Angel investor', city: 'Singapore', field: 'SaaS' },
  // Spanish
  { lang: 'es', text: 'Conocí a Ana Walker tomando un café. Es directora técnica de una startup fintech en Berlín.', first: 'Ana', role: 'CTO', city: 'Berlin', field: 'Fintech' },
  { lang: 'es', text: 'Almorcé con Marcos Lee, un arquitecto de Lisboa. Le interesa el sector inmobiliario.', first: 'Marcos', role: 'Architect', city: 'Lisbon', field: 'Real estate' },
  { lang: 'es', text: 'Hablé con Priya Nair, fotógrafa en Londres que cubre eventos de cripto.', first: 'Priya', role: 'Photographer', city: 'London', field: 'Crypto' },
  { lang: 'es', text: 'Me reuní con Tomás Brandt, director ejecutivo de una empresa de logística. Ahora vive en Ámsterdam.', first: 'Tomás', role: 'CEO', city: 'Amsterdam', field: 'Logistics' },
  { lang: 'es', text: 'Llamé a Julia Costa, abogada de Madrid; hablamos de startups de salud.', first: 'Julia', role: 'Lawyer', city: 'Madrid', field: 'Healthtech' },
  { lang: 'es', text: 'Me encontré con Omar Haddad, gerente de producto en Dubái, apasionado del aprendizaje automático.', first: 'Omar', role: 'Product Manager', city: 'Dubai', field: 'AI' },
  { lang: 'es', text: 'Conocí a Elena Fischer, reclutadora de Viena. Le encantan los videojuegos.', first: 'Elena', role: 'Recruiter', city: 'Vienna', field: 'Gamedev' },
  { lang: 'es', text: 'Café con Noé Kim, inversor ángel en Singapur. Le gusta el SaaS.', first: 'Noé', role: 'Angel investor', city: 'Singapore', field: 'SaaS' },
  // German
  { lang: 'de', text: 'Ich habe Anna Walker bei einem Kaffee getroffen. Sie ist technische Leiterin (CTO) eines Fintech-Startups in Berlin.', first: 'Anna', role: 'CTO', city: 'Berlin', field: 'Fintech' },
  { lang: 'de', text: 'Mittagessen mit Markus Lee, Architekt aus Lissabon. Er interessiert sich für Immobilien.', first: 'Markus', role: 'Architect', city: 'Lisbon', field: 'Real estate' },
  { lang: 'de', text: 'Gespräch mit Priya Nair, Fotografin in London, die Krypto-Events begleitet.', first: 'Priya', role: 'Photographer', city: 'London', field: 'Crypto' },
  { lang: 'de', text: 'Treffen mit Tom Brandt, Geschäftsführer eines Logistikunternehmens. Wohnt jetzt in Amsterdam.', first: 'Tom', role: 'CEO', city: 'Amsterdam', field: 'Logistics' },
  { lang: 'de', text: 'Telefonat mit Julia Costa, Anwältin aus Madrid, es ging um Gesundheits-Startups.', first: 'Julia', role: 'Lawyer', city: 'Madrid', field: 'Healthtech' },
  { lang: 'de', text: 'Omar Haddad getroffen, Produktmanager in Dubai, begeistert von maschinellem Lernen.', first: 'Omar', role: 'Product Manager', city: 'Dubai', field: 'AI' },
  { lang: 'de', text: 'Lena Fischer kennengelernt, Recruiterin aus Wien. Sie mag Videospiele.', first: 'Lena', role: 'Recruiter', city: 'Vienna', field: 'Gamedev' },
  { lang: 'de', text: 'Kaffee mit Noah Kim, Business Angel in Singapur. Mag SaaS.', first: 'Noah', role: 'Angel investor', city: 'Singapore', field: 'SaaS' },
  // French
  { lang: 'fr', text: 'J’ai rencontré Anna Walker autour d’un café. Elle est directrice technique d’une startup fintech à Berlin.', first: 'Anna', role: 'CTO', city: 'Berlin', field: 'Fintech' },
  { lang: 'fr', text: 'Déjeuner avec Marc Lee, architecte de Lisbonne. Il s’intéresse à l’immobilier.', first: 'Marc', role: 'Architect', city: 'Lisbon', field: 'Real estate' },
  { lang: 'fr', text: 'Discussion avec Priya Nair, photographe à Londres, qui couvre des événements crypto.', first: 'Priya', role: 'Photographer', city: 'London', field: 'Crypto' },
  { lang: 'fr', text: 'Rendez-vous avec Tom Brandt, directeur général d’une entreprise de logistique. Il vit maintenant à Amsterdam.', first: 'Tom', role: 'CEO', city: 'Amsterdam', field: 'Logistics' },
  { lang: 'fr', text: 'Appel avec Julia Costa, avocate à Madrid ; nous avons parlé de startups de santé.', first: 'Julia', role: 'Lawyer', city: 'Madrid', field: 'Healthtech' },
  { lang: 'fr', text: 'J’ai croisé Omar Haddad, chef de produit à Dubaï, passionné d’apprentissage automatique.', first: 'Omar', role: 'Product Manager', city: 'Dubai', field: 'AI' },
  { lang: 'fr', text: 'Rencontre avec Léna Fischer, recruteuse de Vienne. Elle aime les jeux vidéo.', first: 'Léna', role: 'Recruiter', city: 'Vienna', field: 'Gamedev' },
  { lang: 'fr', text: 'Café avec Noé Kim, business angel à Singapour. Il aime le SaaS.', first: 'Noé', role: 'Angel investor', city: 'Singapore', field: 'SaaS' },
  // Portuguese
  { lang: 'pt', text: 'Conheci a Ana Walker num café. Ela é diretora técnica de uma startup de fintech em Berlim.', first: 'Ana', role: 'CTO', city: 'Berlin', field: 'Fintech' },
  { lang: 'pt', text: 'Almocei com o Marcos Lee, arquiteto de Lisboa. Ele se interessa por imobiliário.', first: 'Marcos', role: 'Architect', city: 'Lisbon', field: 'Real estate' },
  { lang: 'pt', text: 'Falei com a Priya Nair, fotógrafa em Londres, que cobre eventos de cripto.', first: 'Priya', role: 'Photographer', city: 'London', field: 'Crypto' },
  { lang: 'pt', text: 'Reunião com o Tomás Brandt, diretor executivo de uma empresa de logística. Agora mora em Amsterdã.', first: 'Tomás', role: 'CEO', city: 'Amsterdam', field: 'Logistics' },
  { lang: 'pt', text: 'Liguei para a Julia Costa, advogada de Madri; falamos de startups de saúde.', first: 'Julia', role: 'Lawyer', city: 'Madrid', field: 'Healthtech' },
  { lang: 'pt', text: 'Encontrei o Omar Haddad, gerente de produto em Dubai, apaixonado por aprendizado de máquina.', first: 'Omar', role: 'Product Manager', city: 'Dubai', field: 'AI' },
  { lang: 'pt', text: 'Conheci a Lena Fischer, recrutadora de Viena. Ela gosta de videogames.', first: 'Lena', role: 'Recruiter', city: 'Vienna', field: 'Gamedev' },
  { lang: 'pt', text: 'Café com o Noé Kim, investidor-anjo em Singapura. Gosta de SaaS.', first: 'Noé', role: 'Angel investor', city: 'Singapore', field: 'SaaS' },
  // Ukrainian
  { lang: 'uk', text: 'Познайомився з Анною Волковою за кавою. Вона технічна директорка фінтех-стартапу в Берліні.', first: 'Анна', role: 'CTO', city: 'Berlin', field: 'Fintech' },
  { lang: 'uk', text: 'Пообідав з Маркусом Лі, архітектором з Лісабона. Цікавиться нерухомістю.', first: 'Маркус', role: 'Architect', city: 'Lisbon', field: 'Real estate' },
  { lang: 'uk', text: 'Поспілкувався з Прією Наїр, фотографинею з Лондона, яка знімає крипто-конференції.', first: 'Прія', role: 'Photographer', city: 'London', field: 'Crypto' },
  { lang: 'uk', text: 'Зустрівся з Томом Брандтом, генеральним директором логістичної компанії. Тепер живе в Амстердамі.', first: 'Том', role: 'CEO', city: 'Amsterdam', field: 'Logistics' },
  { lang: 'uk', text: 'Передзвонив Юлії Коста, юристці з Мадрида; говорили про медичні стартапи.', first: 'Юлія', role: 'Lawyer', city: 'Madrid', field: 'Healthtech' },
  { lang: 'uk', text: 'Перетнулися з Омаром Хаддадом, продакт-менеджером у Дубаї, захоплюється нейромережами.', first: 'Омар', role: 'Product Manager', city: 'Dubai', field: 'AI' },
  { lang: 'uk', text: 'Познайомився з Леною Фішер, рекрутеркою з Відня. Любить геймдев.', first: 'Лена', role: 'Recruiter', city: 'Vienna', field: 'Gamedev' },
  { lang: 'uk', text: 'Кава з Ноєм Кім, бізнес-ангелом із Сінгапуру. Цікавиться saas.', first: 'Ной', role: 'Angel investor', city: 'Singapore', field: 'SaaS' },
]

/** What an extractor returns for one note. Anything it could not find is left out. */
export interface Extracted {
  first?: string
  role?: string
  city?: string
  fields?: string[]
}

export type Extractor = (text: string) => Extracted | Promise<Extracted>

export interface Score {
  /** share of notes where the field was found exactly */
  person: number
  role: number
  city: number
  field: number
  /** all four right */
  whole: number
  notes: number
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase()

export async function scoreExtractor(extract: Extractor, corpus: Gold[] = CORPUS): Promise<Record<Lang | 'all', Score>> {
  const langs = [...new Set(corpus.map(g => g.lang))]
  const tally = (list: Gold[], results: Extracted[]): Score => {
    const n = list.length
    const hit = (f: (g: Gold, r: Extracted) => boolean) => list.filter((g, i) => f(g, results[i]!)).length / n
    return {
      person: hit((g, r) => norm(r.first) === norm(g.first)),
      role: hit((g, r) => norm(r.role) === norm(g.role)),
      city: hit((g, r) => norm(r.city) === norm(g.city)),
      field: hit((g, r) => (r.fields ?? []).some(f => norm(f) === norm(g.field))),
      whole: hit((g, r) => norm(r.first) === norm(g.first) && norm(r.role) === norm(g.role) && norm(r.city) === norm(g.city) && (r.fields ?? []).some(f => norm(f) === norm(g.field))),
      notes: n,
    }
  }
  const results = await Promise.all(corpus.map(async g => extract(g.text)))
  const out = { all: tally(corpus, results) } as Record<Lang | 'all', Score>
  for (const lang of langs) {
    const idx = corpus.map((g, i) => (g.lang === lang ? i : -1)).filter(i => i >= 0)
    out[lang] = tally(idx.map(i => corpus[i]!), idx.map(i => results[i]!))
  }
  return out
}
