import type { Gold } from './extraction.corpus'

/**
 * A second set, worded differently and written AFTER the rules, so it was not used to tune them. It shows how much of
 * the first set's score is the rules and how much is the rules fitted to those exact sentences. (Once a miss here is
 * fixed it stops being held out: the honest number is the one measured on the first run, kept in docs/NEURAL.md.)
 */
export const HELD_OUT: Gold[] = [
  { lang: 'en', text: 'Grabbed lunch with Chloe Evans, a lawyer in Paris who works on fintech.', first: 'Chloe', role: 'Lawyer', city: 'Paris', field: 'Fintech' },
  { lang: 'en', text: 'Ran into Daniel Ortiz at the conference. He is a photographer from Rome, shoots real estate.', first: 'Daniel', role: 'Photographer', city: 'Rome', field: 'Real estate' },
  { lang: 'ru', text: 'Вчера созвонились с Игорем Ли, он архитектор из Милана, занимается недвижимостью.', first: 'Игорь', role: 'Architect', city: 'Milan', field: 'Real estate' },
  { lang: 'ru', text: 'Познакомилась с Мариной Орловой на встрече, она рекрутер в Лондоне, любит геймдев.', first: 'Марина', role: 'Recruiter', city: 'London', field: 'Gamedev' },
  { lang: 'es', text: 'Ayer tomé un café con Carmen Ruiz, es arquitecta en Madrid y trabaja con inmobiliarias.', first: 'Carmen', role: 'Architect', city: 'Madrid', field: 'Real estate' },
  { lang: 'es', text: 'Hablé con Pablo Ortega, abogado en Londres, le interesa la inteligencia artificial.', first: 'Pablo', role: 'Lawyer', city: 'London', field: 'AI' },
  { lang: 'es', text: 'Quedé con Sofía Marín, fotógrafa de Lisboa, cubre eventos de videojuegos.', first: 'Sofía', role: 'Photographer', city: 'Lisbon', field: 'Gamedev' },
  { lang: 'es', text: 'Me presentaron a Diego Vela, director ejecutivo de una empresa de logística en Viena.', first: 'Diego', role: 'CEO', city: 'Vienna', field: 'Logistics' },
  { lang: 'de', text: 'Heute Kaffee mit Jonas Keller, Architekt aus Wien, spezialisiert auf Immobilien.', first: 'Jonas', role: 'Architect', city: 'Vienna', field: 'Real estate' },
  { lang: 'de', text: 'Ich habe Mara Hoffmann getroffen, sie ist Anwältin in Berlin und liebt Krypto.', first: 'Mara', role: 'Lawyer', city: 'Berlin', field: 'Crypto' },
  { lang: 'de', text: 'Zufällig Elias Brandt gesehen, Fotograf aus Lissabon, macht Videospiele-Events.', first: 'Elias', role: 'Photographer', city: 'Lisbon', field: 'Gamedev' },
  { lang: 'de', text: 'Telefonat mit Greta Lang, Produktmanagerin in Madrid, es ging um Gesundheit.', first: 'Greta', role: 'Product Manager', city: 'Madrid', field: 'Healthtech' },
  { lang: 'fr', text: 'Hier j’ai déjeuné avec Hugo Martin, avocat à Paris, passionné de cryptomonnaies.', first: 'Hugo', role: 'Lawyer', city: 'Paris', field: 'Crypto' },
  { lang: 'fr', text: 'Rencontre avec Camille Roux, architecte de Lisbonne, intéressée par l’immobilier.', first: 'Camille', role: 'Architect', city: 'Lisbon', field: 'Real estate' },
  { lang: 'fr', text: 'Café avec Inès Moreau, directrice technique à Bruxelles, elle suit la logistique.', first: 'Inès', role: 'CTO', city: 'Brussels', field: 'Logistics' },
  { lang: 'fr', text: 'J’ai croisé Théo Bernard, photographe à Madrid, il travaille dans les jeux vidéo.', first: 'Théo', role: 'Photographer', city: 'Madrid', field: 'Gamedev' },
  { lang: 'pt', text: 'Falei com a Beatriz Lima, advogada em Lisboa, interessada em saúde digital.', first: 'Beatriz', role: 'Lawyer', city: 'Lisbon', field: 'Healthtech' },
  { lang: 'pt', text: 'Almocei com o Rafael Sousa, arquiteto de Madri, trabalha com imobiliário.', first: 'Rafael', role: 'Architect', city: 'Madrid', field: 'Real estate' },
  { lang: 'pt', text: 'Encontrei a Clara Dias, gerente de produto em Berlim, trabalha com inteligência artificial.', first: 'Clara', role: 'Product Manager', city: 'Berlin', field: 'AI' },
  { lang: 'pt', text: 'Tomei um café com o Bruno Alves, fotógrafo em Londres, cobre eventos de cripto.', first: 'Bruno', role: 'Photographer', city: 'London', field: 'Crypto' },
  { lang: 'uk', text: 'Поговорив з Богданом Мельником, юристом із Мадрида, цікавиться крипто.', first: 'Богдан', role: 'Lawyer', city: 'Madrid', field: 'Crypto' },
  { lang: 'uk', text: 'Зустрілася з Олесею Ткач, архітекторкою з Берліна, говорили про нерухомість.', first: 'Олеся', role: 'Architect', city: 'Berlin', field: 'Real estate' },
  { lang: 'uk', text: 'Познайомилась з Тарасом Гончаром, рекрутером у Лондоні, він любить геймдев.', first: 'Тарас', role: 'Recruiter', city: 'London', field: 'Gamedev' },
  { lang: 'uk', text: 'Пообідав із Сашею Бондар, продакт-менеджеркою в Дубаї, говорили про нейромережі.', first: 'Саша', role: 'Product Manager', city: 'Dubai', field: 'AI' },
]
