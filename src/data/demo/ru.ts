import type { DemoPack } from './types'

/** Russian demo: 32 fictional people and 23 reserve contacts. */
export const RU_PACK: DemoPack = {
  batchSource: 'Web Summit',
  seeds: [
  { f: 'Алина', l: 'Воронцова', role: 'Основательница', co: 'Lumen Labs', city: 'Москва', c: 1, circles: ['Друзья', 'Работа'], tags: ['AI', 'Продукт', 'Йога'], last: 4, bday: 6, age: 31, met: 1460, place: 'Стрелка, лекция про дизайн', story: 'Разговорились в очереди за кофе, оказалось — читали одни и те же рассылки.', tg: 'alina_vrn', phone: '+7 916 204-18-77', ig: 'alina.vrn', facts: [{ icon: 'coffee', text: 'Пьёт только фильтр, никакого молока' }, { icon: 'plane', text: 'Каждый январь — месяц в Азии' }, { icon: 'book', text: 'Перечитывает «Мастера и Маргариту» раз в год' }], family: 'Муж Артём, дочь Ева (4 года)', help: 'Сильнейший продуктовый взгляд, связи в AI-стартапах', ihelp: 'Найм инженеров, интро в фонды', seek: 'CTO в новый AI-стартап — сильного инженера-кофаундера', topics: ['Как прошёл раунд', 'Поездка на Бали в январе'], gifts: 'Керамика ручной работы, хороший зерновой кофе', pinned: true, notes: 'Запускает второй продукт — AI-ассистент для юристов. Ищет CTO.' },
  { f: 'Марк', l: 'Левин', role: 'Партнёр', co: 'Polaris Ventures', city: 'Дубай', c: 2, circles: ['Инвесторы'], tags: ['Венчур', 'Fintech', 'Теннис'], last: 41, bday: 19, age: 38, met: 820, place: 'Web Summit, Лиссабон', story: 'Познакомил Илья на ужине основателей после второго дня.', tg: 'mark_levin', email: 'mark@polaris.vc', li: 'marklevin', facts: [{ icon: 'trophy', text: 'Играет в теннис по воскресеньям в 8 утра' }, { icon: 'globe', text: 'Говорит на 4 языках' }], help: 'Seed/A раунды в fintech, сильная сеть в MENA', ihelp: 'Делюсь дилфлоу из СНГ', seek: 'Сильные fintech-команды на seed', topics: ['Новый фонд на $120M', 'Его взгляд на B2B AI'], pinned: true, cadence: 30 },
  { f: 'Илья', l: 'Ковалёв', role: 'CEO', co: 'Кварц', city: 'Москва', c: 1, circles: ['Друзья', 'Работа'], tags: ['SaaS', 'Бег', 'Вино'], last: 9, bday: 87, age: 34, met: 2900, place: 'Университет, общага', tg: 'ilya_k', phone: '+7 903 777-12-04', facts: [{ icon: 'trophy', text: 'Пробежал 6 марафонов, цель — Берлин' }, { icon: 'food', text: 'Не ест глютен' }], family: 'Жена Даша', help: 'Честный фидбек по всему', ihelp: 'Поддержка, интро', topics: ['Подготовка к Берлинскому марафону'], gifts: 'Бутылка хорошего риохи', pinned: true },
  { f: 'Софья', l: 'Аль-Масри', role: 'Head of Design', co: 'Orbita', city: 'Белград', c: 2, circles: ['Работа', 'Сообщество'], tags: ['Дизайн', 'Типографика', 'Керамика'], last: 64, bday: 132, age: 29, met: 600, place: 'Config, Сан-Франциско', tg: 'sofi_design', ig: 'sofi.makes', facts: [{ icon: 'sparkle', text: 'Делает керамику и продаёт на маркетах' }, { icon: 'paw', text: 'Кот по имени Шрифт' }], ihelp: 'Делюсь вакансиями', help: 'Может посоветовать дизайнеров', seek: 'Переезд в Лиссабон, ищет, с кем там познакомиться', topics: ['Её доклад на Config', 'Переезд из Белграда?'] },
  { f: 'Тимур', l: 'Абаев', role: 'Ангел-инвестор', co: 'TA Capital', city: 'Алматы', c: 2, circles: ['Инвесторы', 'Менторы'], tags: ['Ангел', 'EdTech', 'Горы'], last: 95, bday: 2, age: 45, met: 1100, place: 'Демо-день акселератора', tg: 'timur_abaev', phone: '+7 701 555-90-11', facts: [{ icon: 'trophy', text: 'Поднимался на Эльбрус' }, { icon: 'heart', text: 'Помогает детскому фонду' }], help: 'Чеки до $100K, экспертиза в edtech', seek: 'Edtech-проекты для инвестиций', topics: ['Поздравить с днём рождения', 'Спросить про новый edtech-портфель'], gifts: 'Книги по истории, хороший чай' },
  { f: 'Вера', l: 'Миронова', role: 'Продюсер', co: 'Сцена', city: 'Санкт-Петербург', c: 3, circles: ['Сообщество'], tags: ['Ивенты', 'Музыка'], last: 130, bday: 210, met: 400, place: 'Ужин основателей', tg: 'vera_m', facts: [{ icon: 'music', text: 'Играет на виолончели' }], ihelp: 'Спикеры для её конференции', seek: 'Спикеры про AI и продукт для конференции' },
  { f: 'Даниил', l: 'Огнев', role: 'CTO', co: 'Fintrack', city: 'Тбилиси', c: 2, circles: ['Работа'], tags: ['Backend', 'Rust', 'Шахматы'], last: 22, bday: 41, age: 33, met: 700, place: 'Хакатон в Тбилиси', tg: 'dogn', email: 'daniil@fintrack.io', facts: [{ icon: 'trophy', text: 'Рейтинг 2100 на lichess' }], help: 'Архитектура, найм бэкендеров, Rust', seek: 'Новый вызов: технический кофаундер в AI-проекте', topics: ['Переход на Rust — итоги'] },
  { f: 'Ева', l: 'Ланская', role: 'Журналистка', co: 'Forbes', city: 'Москва', c: 3, circles: ['Сообщество'], tags: ['Медиа', 'Стартапы'], last: 58, bday: 250, met: 300, place: 'Пресс-завтрак', tg: 'eva_lanskaya', email: 'eva@media.ru', help: 'Может написать про запуск, медиа и PR', seek: 'Истории основателей для рубрики', topics: ['Предложить историю про наш запуск'] },
  { f: 'Георгий', l: 'Сайфуллин', role: 'Управляющий директор', co: 'Северный Ветер Капитал', city: 'Москва', c: 3, circles: ['Инвесторы'], tags: ['PE', 'Гольф'], last: 210, bday: 300, met: 900, place: 'Конференция «Капитал»', email: 'g.s@nwcap.ru', li: 'gsaifullin', help: 'Поздние стадии, LP-связи' },
  { f: 'Нина', l: 'Чернова', role: 'Психотерапевт', co: 'Частная практика', city: 'Лиссабон', c: 1, circles: ['Друзья'], tags: ['Психология', 'Сёрф'], last: 17, bday: 11, age: 32, met: 3600, place: 'Школа', tg: 'nina_ch', phone: '+351 912 044 310', ig: 'nina.waves', help: 'Всё о жизни и переезде в Лиссабон', facts: [{ icon: 'plane', text: 'Переехала в Лиссабон в 2023' }, { icon: 'sparkle', text: 'Учится сёрфингу' }], family: 'Партнёр Жоау', topics: ['Как адаптация в Португалии', 'Позвать в гости весной'], gifts: 'Книги Ирвина Ялома, свечи' },
  { f: 'Рустам', l: 'Галиев', role: 'Основатель', co: 'Taxi Hub', city: 'Казань', c: 3, circles: ['Сообщество', 'Клиенты'], tags: ['Мобильность', 'B2B'], last: 75, bday: 160, met: 500, place: 'Startup Village', tg: 'rustam_g', ihelp: 'Познакомил с юристом', seek: 'UX-дизайнер для мобильного приложения' },
  { f: 'Полина', l: 'Шестакова', role: 'VP Product', co: 'Яркий Банк', city: 'Москва', c: 2, circles: ['Работа', 'Менторы'], tags: ['Fintech', 'Продукт', 'Пилатес'], last: 33, bday: 27, age: 36, met: 1300, place: 'Продуктовый митап', tg: 'polina_sh', email: 'polina@bright.bank', facts: [{ icon: 'book', text: 'Ведёт канал про продукт на 40K' }], help: 'Менторит по продуктовой стратегии и продукту', seek: 'Сильные продакты в команду', topics: ['Её мнение о новой метрике удержания'] },
  { f: 'Артур', l: 'Мкртчян', role: 'Основатель', co: 'Nairi Games', city: 'Ереван', c: 3, circles: ['Сообщество'], tags: ['Геймдев', 'Unity'], last: 160, bday: 90, met: 650, place: 'DevGAMM', tg: 'arthur_m' },
  { f: 'Кира', l: 'Белова', role: 'Recruiter', co: 'TalentBridge', city: 'Берлин', c: 3, circles: ['Работа'], tags: ['Найм', 'HR'], last: 48, bday: 330, met: 420, place: 'LinkedIn', li: 'kirabelova', email: 'kira@talentbridge.de', help: 'Найм в Европе', ihelp: 'Рекомендую кандидатов', seek: 'Продакты и дизайнеры для клиентов' },
  { f: 'Олег', l: 'Захаров', role: 'Ментор', co: 'ex-Яндекс', city: 'Москва', c: 2, circles: ['Менторы'], tags: ['Лидерство', 'Масштабирование'], last: 70, bday: 55, age: 52, met: 1800, place: 'Программа менторства', tg: 'oleg_z', phone: '+7 985 120-44-09', facts: [{ icon: 'book', text: 'Пишет книгу про управление' }, { icon: 'coffee', text: 'Встречи только до 10 утра' }], help: 'Как выстроить C-level команду', topics: ['Как продвигается книга', 'Совет по найму COO'], gifts: 'Редкие издания по истории менеджмента' },
  { f: 'Яна', l: 'Ким', role: 'Иллюстратор', co: 'Freelance', city: 'Санкт-Петербург', c: 4, circles: ['Сообщество'], tags: ['Иллюстрация'], last: 300, bday: 120, met: 380, place: 'Маркет «Ламбада»', ig: 'yana.kim.art' },
  { f: 'Степан', l: 'Орлов', role: 'Product Manager', co: 'Кварц', city: 'Москва', c: 3, circles: ['Работа'], tags: ['Продукт', 'Аналитика'], last: 12, bday: 230, met: 200, place: 'Через Илью', tg: 'stepan_orlov', seek: 'Ментор по продукту' },
  { f: 'Лейла', l: 'Гасанова', role: 'Партнёр', co: 'Caspian Angels', city: 'Баку', c: 3, circles: ['Инвесторы'], tags: ['Ангел', 'Healthtech'], last: 120, bday: 15, age: 41, met: 760, place: 'Web Summit, Лиссабон', tg: 'leyla_g', email: 'leyla@caspian.vc', help: 'Healthtech, синдикаты' , seek: 'Healthtech-стартапы' },
  { f: 'Максим', l: 'Деев', role: 'Тренер', co: 'Run Club', city: 'Москва', c: 2, circles: ['Спорт', 'Друзья'], tags: ['Бег', 'Триатлон'], last: 6, bday: 180, met: 950, place: 'Утренняя пробежка в парке Горького', tg: 'max_deev', phone: '+7 926 330-71-55', facts: [{ icon: 'trophy', text: 'Ironman в 2024' }] },
  { f: 'Анна', l: 'Ривера', role: 'Country Manager', co: 'Glovo', city: 'Барселона', c: 4, circles: ['Работа'], tags: ['Операции', 'Ритейл'], last: 400, bday: 270, met: 1000, place: 'Кейс-чемпионат', li: 'annarivera' },
  { f: 'Фёдор', l: 'Ветров', role: 'Юрист', co: 'Ветров и партнёры', city: 'Москва', c: 3, circles: ['Клиенты', 'Работа'], tags: ['Право', 'M&A'], last: 88, bday: 140, met: 1200, place: 'Рекомендация Рустама', email: 'f.vetrov@vplaw.ru', phone: '+7 495 777-30-30', help: 'Сделки, корпоративка' },
  { f: 'Маргарита', l: 'Сон', role: 'Основательница', co: 'Mochi Tea', city: 'Сеул', c: 3, circles: ['Сообщество'], tags: ['Ритейл', 'Бренд'], last: 140, bday: 70, met: 540, place: 'Ужин основателей', ig: 'mochi.tea', tg: 'rita_son', seek: 'PR и медиа о запуске бренда' },
  { f: 'Дмитрий', l: 'Бахтин', role: 'Генеральный директор', co: 'Ural Robotics', city: 'Екатеринбург', c: 3, circles: ['Клиенты'], tags: ['Робототехника', 'Hardware'], last: 26, bday: 205, met: 300, place: 'Иннопром', email: 'd.bakhtin@uralrobotics.ru' },
  { f: 'Ксения', l: 'Лебедь', role: 'Сестра', co: '', city: 'Москва', c: 1, circles: ['Семья'], tags: ['Танцы'], last: 3, bday: 99, age: 27, tg: 'ksu_lebed', phone: '+7 999 101-20-30', facts: [{ icon: 'music', text: 'Танцует контемпорари' }], gifts: 'Сертификат в студию танца', cadence: 7 },
  { f: 'Пётр', l: 'Лебедь', role: 'Отец', co: '', city: 'Тверь', c: 1, circles: ['Семья'], tags: ['Рыбалка', 'История'], last: 19, bday: 160, age: 63, phone: '+7 910 555-00-12', facts: [{ icon: 'book', text: 'Собирает книги по истории флота' }], cadence: 7 },
  { f: 'Арина', l: 'Тихонова', role: 'Data Scientist', co: 'Lumen Labs', city: 'Москва', c: 4, circles: ['Работа'], tags: ['ML', 'Python'], last: 9, bday: 310, met: 9, place: 'Через Алину', tg: 'arina_t' },
  { f: 'Хасан', l: 'Юсупов', role: 'Основатель', co: 'Oasis Pay', city: 'Дубай', c: 3, circles: ['Сообщество', 'Клиенты'], tags: ['Fintech', 'MENA'], last: 100, bday: 60, met: 480, place: 'Gitex, Дубай', tg: 'hasan_y', phone: '+971 50 123 4567', help: 'Платёжная инфраструктура в MENA', seek: 'Инвестор для seed-раунда, fintech MENA' },
  { f: 'Ольга', l: 'Крылова', role: 'Директор по маркетингу', co: 'Мята Студио', city: 'Новосибирск', c: 4, circles: ['Клиенты'], tags: ['Маркетинг', 'Бренд'], last: 260, bday: 23, met: 700, place: 'Вебинар', email: 'olga@myata.studio' },
  { f: 'Глеб', l: 'Романов', role: 'Венчурный аналитик', co: 'Polaris Ventures', city: 'Дубай', c: 4, circles: ['Инвесторы'], tags: ['Венчур', 'Аналитика'], last: 11, bday: 280, met: 18, place: 'Через Марка', tg: 'gleb_r' },
  { f: 'Лиза', l: 'Мур', role: 'Дизайнер', co: 'Orbita', city: 'Белград', c: 3, circles: ['Работа', 'Друзья'], tags: ['UX', 'Фотография'], last: 20, bday: 190, met: 25, place: 'Через Софью', ig: 'liza.moor', tg: 'lizamoor', help: 'UX и мобильный дизайн' },
  { f: 'Аслан', l: 'Хаджиев', role: 'Партнёр', co: 'Peak Ventures', city: 'Москва', c: 2, circles: ['Инвесторы', 'Менторы'], tags: ['Венчур', 'Deep tech', 'Горы'], last: 150, bday: 45, age: 47, met: 1500, place: 'Ужин фонда', tg: 'aslan_kh', email: 'aslan@peak.vc', help: 'Deep tech, сильные LP', topics: ['Апдейт по метрикам', 'Позвать на демо'] },
  { f: 'Виктория', l: 'Зайцева', role: 'COO', co: 'Fintrack', city: 'Тбилиси', c: 3, circles: ['Работа'], tags: ['Операции', 'Fintech'], last: 37, bday: 220, met: 700, place: 'Хакатон в Тбилиси', tg: 'vika_z' },
  ],
  titles: {
  meeting: ['Кофе в «Скуратов»', 'Завтрак перед конференцией', 'Обед в центре', 'Встреча в офисе', 'Прогулка по набережной', 'Ужин на Патриках'],
  call: ['Созвон по партнёрству', 'Быстрый звонок', 'Созвон: фидбек по питчу', 'Видеозвонок, обсудили планы'],
  message: ['Переписка в Telegram', 'Поздравил с запуском', 'Скинул статью про AI', 'Обменялись новостями'],
  event: ['Web Summit', 'Startup Village', 'Демо-день акселератора', 'Ужин основателей', 'Продуктовый митап'],
  favor_given: ['Познакомил с инвестором', 'Помог с наймом дизайнера', 'Дал фидбек по деку'],
  favor_got: ['Интро в фонд', 'Рекомендовал юриста', 'Помог с релокацией'],
  gift: ['Подарил книгу «Hooked»', 'Отправил цветы', 'Привёз кофе из Эфиопии'],
  note: ['Заметка'],
  },
  notes: {
  meeting: [
    'Обсудили новый продукт — хочет показать прототип через месяц.',
    'Очень тёплая встреча. Договорились видеться чаще.',
    'Рассказал про наш раунд, обещал подумать про интро.',
    'Говорили про найм — ищет сильного продакта.',
    'Посоветовал книгу «Сила привычки», надо скинуть ссылку.',
  ],
  call: [
    'Обсудили партнёрство, ждёт от нас предложение до пятницы.',
    'Дал фидбек по питч-деку: сократить до 12 слайдов.',
    'Быстро сверили планы на квартал.',
  ],
  message: [
    'Поздравил с запуском, ответил очень тепло.',
    'Скинул статью про AI-агентов — обсудим при встрече.',
    'Обменялись новостями, зовёт в гости весной.',
  ],
  event: [
    'Пересеклись в кулуарах, договорились о созвоне.',
    'Сидели за одним столом, много говорили про рынок.',
  ],
  favor_given: ['Познакомил с инвестором из Polaris — сказал спасибо.', 'Порекомендовал двух сильных дизайнеров.'],
  favor_got: ['Сделал интро в фонд, очень помог.', 'Посоветовал юриста по релокации.'],
  gift: ['Очень обрадовался подарку.'],
  },
  leads: [
  { f: 'Давид', l: 'Шварц', role: 'Управляющий партнёр', co: 'Northwind Capital', city: 'Дубай', why: 'Инвестирует в seed fintech в MENA, ищет сильные команды', src: 'Web Summit', tags: ['Инвестор', 'Fintech'], d: 3, tg: 'dshwarz', ph: '+971 50 214 7788', star: true },
  { f: 'Саид', l: 'аль-Мансури', role: 'Основатель семейного офиса', co: 'Gulf Ventures', city: 'Дубай', why: 'Миллионер: семейный офис, вкладывается в недвижимость и технологии', src: 'Ужин в Дубае', tags: ['Инвестор', 'Бизнес'], d: 9, ph: '+971 55 303 1122', em: 'office@gulfventures.example', star: true },
  { f: 'Милана', l: 'Орлова', role: 'Lead Product Designer', co: 'Pixel & Co', city: 'Лондон', why: 'UX мобильных приложений, строит дизайн-системы', src: 'Dribbble', tags: ['Дизайн'], d: 12, tg: 'milana_orlova', li: 'https://www.linkedin.com/in/milana-orlova-3b2a1c' },
  { f: 'Георгий', l: 'Ларин', role: 'Редактор раздела «Бизнес»', co: 'Деловой вестник', city: 'Москва', why: 'Пишет про стартапы и запуски, берёт колонки основателей', src: 'Конференция РИФ', tags: ['Медиа'], d: 14, tg: 'g_larin', em: 'larin@vestnik.example' },
  { f: 'Эмма', l: 'Лоренц', role: 'CPO', co: 'Orbit Health', city: 'Берлин', why: 'Менторит по продукту и росту, ведёт продуктовую школу', src: 'От Алины', tags: ['Продукт', 'Ментор'], d: 16, li: 'https://www.linkedin.com/in/emma-lorenz-77a1b2', star: true },
  { f: 'Анна', l: 'Беккер', role: 'Юрист по сделкам', co: 'Lexa Partners', city: 'Москва', why: 'Сопровождает M&A и инвестиционные раунды, корпоративное право', src: 'Чат фаундеров', tags: ['Юрист'], d: 18, tg: 'anna_becker', em: 'a.becker@lexa.example' },
  { f: 'Виктор', l: 'Нам', role: 'CTO', co: 'Quantum Labs', city: 'Сеул', why: 'Архитектор высоконагруженных систем, Rust', src: 'GitHub', tags: ['Разработка', 'AI'], d: 20, li: 'https://www.linkedin.com/in/viktor-nam-9c3d1e' },
  { f: 'Лика', l: 'Гарсия', role: 'Head of Talent', co: 'Nova', city: 'Барселона', why: 'Знает рынок кандидатов в Европе, быстро находит инженеров', src: 'LinkedIn', tags: ['HR'], d: 21, li: 'https://www.linkedin.com/in/lika-garcia-5e8f20' },
  { f: 'Тимофей', l: 'Рогов', role: 'Основатель', co: 'ProLogistics', city: 'Москва', why: 'Бизнесмен, логистика, выручка больше миллиарда, открыт к инвестициям в стартапы', src: 'Ужин основателей', tags: ['Бизнес', 'Инвестор'], d: 23, ph: '+7 916 400 25 25', star: true },
  { f: 'Ирина', l: 'Воронова', role: 'Бренд-директор', city: 'Тбилиси', why: 'Запускает consumer-бренды, знает все PR-агентства города', src: 'От Марка', tags: ['Маркетинг', 'Медиа'], d: 26, tg: 'irina_brand' },
  { f: 'Райан', l: 'Фостер', role: 'Партнёр', co: 'Seed Garden', city: 'Лондон', why: 'Seed и серия A, B2B SaaS, отвечает быстро', src: 'LinkedIn', tags: ['Инвестор'], d: 28, li: 'https://www.linkedin.com/in/ryan-foster-2a9b4c', em: 'ryan@seedgarden.example' },
  { f: 'Нурлан', l: 'Абенов', role: 'Руководитель департамента', co: 'Министерство цифровизации', city: 'Астана', why: 'Связи в госструктурах Казахстана, помогает с регуляторикой', src: 'Форум в Астане', tags: ['Власть'], d: 31, ph: '+7 701 555 40 40' },
  { f: 'София', l: 'Кларк', role: 'Ведущая подкаста «Founders Talk»', city: 'Лиссабон', why: 'Берёт интервью у основателей, аудитория 40 тысяч. Знает русскоязычных в Лиссабоне', src: 'Web Summit', tags: ['Медиа'], d: 33, tg: 'sofia_clark_pod', star: true },
  { f: 'Дмитрий', l: 'Яхин', role: 'CFO', co: 'Группа Ардис', city: 'Москва', why: 'Финансовая модель, due diligence, налоговое планирование', src: 'От Тимура', tags: ['Финансы'], d: 35, em: 'yakhin@ardis.example' },
  { f: 'Алия', l: 'Сарсенова', role: 'Продакт-директор', city: 'Алматы', why: 'Масштабировала fintech-продукт до 2 млн пользователей', src: 'Чат продактов', tags: ['Продукт', 'Fintech'], d: 36, tg: 'aliya_pm' },
  { f: 'Макс', l: 'Фишер', role: 'Основатель', co: 'Alpine Crypto Fund', city: 'Цюрих', why: 'Крипто-фонд, инфраструктура web3, чек от 500 тысяч', src: 'Конференция в Цюрихе', tags: ['Крипто', 'Инвестор'], d: 38, tg: 'maxfischer_cz' },
  { f: 'Елена', l: 'Мартынова', role: 'Врач-кардиолог', co: 'Клиника Современная медицина', city: 'Москва', why: 'Хороший врач на всякий случай, принимает по рекомендации', src: 'От мамы', tags: ['Медицина'], d: 40, ph: '+7 495 123 45 67' },
  { f: 'Павел', l: 'Дроздов', role: 'Девелопер', city: 'Дубай', why: 'Недвижимость в ОАЭ, готовые объекты, помогает с документами', src: 'Чат релокации', tags: ['Недвижимость'], d: 41, tg: 'drozdov_dxb', ph: '+971 52 600 11 99' },
  { f: 'Ким', l: 'Сон-у', role: 'Venture partner', co: 'Han River Ventures', city: 'Сеул', why: 'Корейский рынок и выход в Азию, инвестор', src: 'Web Summit', tags: ['Инвестор'], d: 44, li: 'https://www.linkedin.com/in/kim-sonu-1f4a9d' },
  { f: 'Оксана', l: 'Лисина', role: 'Организатор конференций', city: 'Москва', why: 'Знает всех спикеров, ведёт сцены на конференциях по AI', src: 'Конференция РИФ', tags: ['Ивенты', 'AI'], d: 47, tg: 'oksana_events' },
  { f: 'Арман', l: 'Касымов', role: 'Юрист по релокации', city: 'Дубай', why: 'Виза и ВНЖ в ОАЭ, открытие компаний во Free Zone', src: 'Чат релокации', tags: ['Юрист'], d: 50, tg: 'arman_visa_uae', em: 'arman@relocate.example' },
  { f: 'Лиам', l: 'О’Коннор', role: 'Head of AI', co: 'Stealth', city: 'Сан-Франциско', why: 'LLM-инфраструктура, ищет русскоязычных инженеров', src: 'LinkedIn', tags: ['AI', 'Разработка'], d: 52, li: 'https://www.linkedin.com/in/liam-oconnor-6d2c8a' },
  { f: 'Вера', l: 'Ким', role: 'Коуч', city: 'Алматы', why: 'Менторство для фаундеров, помогает с выгоранием и решениями', src: 'Подкаст', tags: ['Ментор'], d: 55, tg: 'vera_kim_coach' },
  ],
  relate: byName => {
    byName('Марк').introducedBy = byName('Илья').id
    byName('Степан').introducedBy = byName('Илья').id
    byName('Арина').introducedBy = byName('Алина').id
    byName('Лиза').introducedBy = byName('Софья').id
    byName('Глеб').introducedBy = byName('Марк').id
    byName('Фёдор').introducedBy = byName('Рустам').id
    byName('Алина').links = [{ personId: byName('Илья').id, label: 'дружат с универа' }, { personId: byName('Арина').id, label: 'коллеги' }]
    byName('Илья').links = [{ personId: byName('Алина').id, label: 'друзья' }, { personId: byName('Степан').id, label: 'работают вместе' }]
    byName('Марк').links = [{ personId: byName('Глеб').id, label: 'коллеги по фонду' }]
    byName('Даниил').links = [{ personId: byName('Виктория').id, label: 'сооснователи' }]
    byName('Ксения').links = [{ personId: byName('Пётр').id, label: 'дочь' }]
    byName('Пётр').links = [{ personId: byName('Ксения').id, label: 'отец' }]
  },
  extraInteractions: (byName, today, uid) => {
    const ws = today - 120 * 86_400_000
    return [
      { id: uid(), personIds: [byName('Лейла').id, byName('Марк').id, byName('Хасан').id], type: 'event', date: ws, title: 'Web Summit — ужин основателей', place: 'Лиссабон', note: 'Сидели за одним столом, договорились о созвоне по MENA-рынку.', createdAt: ws },
      { id: uid(), personIds: [byName('Алина').id], type: 'note', date: today - 2 * 86_400_000, title: 'Заметка', note: 'Алина ищет CTO — подумать, кого из сети порекомендовать (Даниил?).', createdAt: today - 2 * 86_400_000 },
    ]
  },
  reminders: (byName, today, now, uid) => [
    { id: uid(), personId: byName('Алина').id, text: 'Познакомить с Даниилом — ищет CTO', dueAt: today + 1 * 86_400_000 + 11 * 3600_000, done: false, createdAt: now },
    { id: uid(), personId: byName('Марк').id, text: 'Отправить апдейт по метрикам', dueAt: today + 18 * 3600_000, done: false, createdAt: now },
    { id: uid(), personId: byName('Тимур').id, text: 'Поздравить с днём рождения', dueAt: today + 2 * 86_400_000 + 10 * 3600_000, done: false, createdAt: now },
    { id: uid(), personId: byName('Олег').id, text: 'Спросить совет по найму COO', dueAt: today + 5 * 86_400_000, done: false, createdAt: now },
    { id: uid(), personId: byName('Ева').id, text: 'Предложить историю про запуск', dueAt: today - 1 * 86_400_000 + 15 * 3600_000, done: false, createdAt: now },
  ],
}
