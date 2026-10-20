import type { DemoPack } from './types'

/** English demo: 32 fictional people and 23 reserve contacts. */
export const EN_PACK: DemoPack = {
  batchSource: 'Web Summit',
  seeds: [
    { f: 'Alice', l: 'Hart', role: 'Founder', co: 'Lumen Labs', city: 'London', c: 1, circles: ['Friends', 'Work'], tags: ['AI', 'Product', 'Yoga'], last: 4, bday: 6, age: 31, met: 1460, place: 'Design lecture at the Barbican', story: 'Started chatting in a coffee queue and found out we read the same newsletters.', tg: 'alice_hart', phone: '+44 7700 900 177', ig: 'alice.hart', facts: [{ icon: 'coffee', text: 'Only drinks filter coffee, no milk' }, { icon: 'plane', text: 'Spends every January in Asia' }, { icon: 'book', text: 'Rereads “The Master and Margarita” once a year' }], family: 'Husband Arthur, daughter Eve (4)', help: 'A great product eye, connections in AI startups', ihelp: 'Hiring engineers, intros to funds', seek: 'A CTO for a new AI startup: a strong engineer co-founder', topics: ['How the round went', 'The trip to Bali in January'], gifts: 'Handmade ceramics, good beans', pinned: true, notes: 'Launching a second product, an AI assistant for lawyers. Looking for a CTO.' },
    { f: 'Mark', l: 'Levin', role: 'Partner', co: 'Polaris Ventures', city: 'Dubai', c: 2, circles: ['Investors'], tags: ['Venture', 'Fintech', 'Tennis'], last: 41, bday: 19, age: 38, met: 820, place: 'Web Summit, Lisbon', story: 'Ethan introduced us at the founders’ dinner after day two.', tg: 'mark_levin', email: 'mark@polaris.example', li: 'marklevin', facts: [{ icon: 'trophy', text: 'Plays tennis on Sundays at 8am' }, { icon: 'globe', text: 'Speaks four languages' }], help: 'Seed/A rounds in fintech, a strong network in MENA', ihelp: 'I share deal flow from Europe', seek: 'Strong fintech teams at seed', topics: ['The new $120M fund', 'His take on B2B AI'], pinned: true, cadence: 30 },
    { f: 'Ethan', l: 'Cole', role: 'CEO', co: 'Quartz', city: 'London', c: 1, circles: ['Friends', 'Work'], tags: ['SaaS', 'Running', 'Wine'], last: 9, bday: 87, age: 34, met: 2900, place: 'University dorm', tg: 'ethan_cole', phone: '+44 7700 900 204', facts: [{ icon: 'trophy', text: 'Has run six marathons, next goal is Berlin' }, { icon: 'food', text: 'Gluten-free' }], family: 'Wife Dana', help: 'Honest feedback on everything', ihelp: 'Support, intros', topics: ['Berlin marathon training'], gifts: 'A good bottle of Rioja', pinned: true },
    { f: 'Sofia', l: 'Al-Masri', role: 'Head of Design', co: 'Orbita', city: 'Belgrade', c: 2, circles: ['Work', 'Community'], tags: ['Design', 'Typography', 'Ceramics'], last: 64, bday: 132, age: 29, met: 600, place: 'Config, San Francisco', tg: 'sofi_design', ig: 'sofi.makes', facts: [{ icon: 'sparkle', text: 'Makes ceramics and sells them at markets' }, { icon: 'paw', text: 'Has a cat called Serif' }], ihelp: 'Shares job openings', help: 'Can recommend designers', seek: 'Moving to Lisbon, wants to meet people there', topics: ['Her talk at Config', 'Moving from Belgrade?'] },
    { f: 'Tim', l: 'Abbott', role: 'Angel investor', co: 'TA Capital', city: 'New York', c: 2, circles: ['Investors', 'Mentors'], tags: ['Angel', 'EdTech', 'Mountains'], last: 95, bday: 2, age: 45, met: 1100, place: 'Accelerator demo day', tg: 'tim_abbott', phone: '+1 212 555 0190', facts: [{ icon: 'trophy', text: 'Climbed Kilimanjaro' }, { icon: 'heart', text: 'Supports a children’s charity' }], help: 'Cheques up to $100K, edtech expertise', seek: 'Edtech projects to invest in', topics: ['Wish him a happy birthday', 'Ask about the new edtech portfolio'], gifts: 'History books, good tea' },
    { f: 'Vera', l: 'Moss', role: 'Producer', co: 'Stage', city: 'Edinburgh', c: 3, circles: ['Community'], tags: ['Events', 'Music'], last: 130, bday: 210, met: 400, place: 'Founders’ dinner', tg: 'vera_moss', facts: [{ icon: 'music', text: 'Plays the cello' }], ihelp: 'Speakers for her conference', seek: 'Speakers on AI and product for the conference' },
    { f: 'Daniel', l: 'Ogden', role: 'CTO', co: 'Fintrack', city: 'Dublin', c: 2, circles: ['Work'], tags: ['Backend', 'Rust', 'Chess'], last: 22, bday: 41, age: 33, met: 700, place: 'Hackathon in Dublin', tg: 'dogden', email: 'daniel@fintrack.example', facts: [{ icon: 'trophy', text: 'Rated 2100 on lichess' }], help: 'Architecture, backend hiring, Rust', seek: 'A new challenge: technical co-founder of an AI project', topics: ['Moving to Rust: the results'] },
    { f: 'Eva', l: 'Lang', role: 'Journalist', co: 'The Ledger', city: 'New York', c: 3, circles: ['Community'], tags: ['Media', 'Startups'], last: 58, bday: 250, met: 300, place: 'Press breakfast', tg: 'eva_lang', email: 'eva@ledger.example', help: 'Can write about a launch, media and PR', seek: 'Founder stories for her column', topics: ['Pitch her the story of our launch'] },
    { f: 'George', l: 'Sullivan', role: 'Managing director', co: 'Boreal Capital', city: 'Boston', c: 3, circles: ['Investors'], tags: ['PE', 'Golf'], last: 210, bday: 300, met: 900, place: 'Capital conference', email: 'g.s@boreal.example', li: 'gsullivan', help: 'Late stage, LP connections' },
    { f: 'Nina', l: 'Carter', role: 'Psychotherapist', co: 'Private practice', city: 'Lisbon', c: 1, circles: ['Friends'], tags: ['Psychology', 'Surfing'], last: 17, bday: 11, age: 32, met: 3600, place: 'School', tg: 'nina_carter', phone: '+351 912 044 310', ig: 'nina.waves', help: 'Everything about life and moving to Lisbon', facts: [{ icon: 'plane', text: 'Moved to Lisbon in 2023' }, { icon: 'sparkle', text: 'Learning to surf' }], family: 'Partner João', topics: ['How is settling in Portugal going', 'Invite her to visit in spring'], gifts: 'Books by Irvin Yalom, candles' },
    { f: 'Raj', l: 'Gill', role: 'Founder', co: 'RideHub', city: 'Manchester', c: 3, circles: ['Community', 'Clients'], tags: ['Mobility', 'B2B'], last: 75, bday: 160, met: 500, place: 'Startup Village', tg: 'raj_gill', ihelp: 'Introduced me to a lawyer', seek: 'A UX designer for the mobile app' },
    { f: 'Paula', l: 'Shaw', role: 'VP Product', co: 'Bright Bank', city: 'London', c: 2, circles: ['Work', 'Mentors'], tags: ['Fintech', 'Product', 'Pilates'], last: 33, bday: 27, age: 36, met: 1300, place: 'Product meetup', tg: 'paula_shaw', email: 'paula@bright.example', facts: [{ icon: 'book', text: 'Runs a product channel with 40K readers' }], help: 'Mentors on product strategy and product', seek: 'Strong product managers for the team', topics: ['Her view on the new retention metric'] },
    { f: 'Arthur', l: 'Mills', role: 'Founder', co: 'Nairi Games', city: 'Yerevan', c: 3, circles: ['Community'], tags: ['Gamedev', 'Unity'], last: 160, bday: 90, met: 650, place: 'DevGAMM', tg: 'arthur_mills' },
    { f: 'Kira', l: 'Bell', role: 'Recruiter', co: 'TalentBridge', city: 'Berlin', c: 3, circles: ['Work'], tags: ['Hiring', 'HR'], last: 48, bday: 330, met: 420, place: 'LinkedIn', li: 'kirabell', email: 'kira@talentbridge.example', help: 'Hiring in Europe', ihelp: 'I recommend candidates', seek: 'Product managers and designers for clients' },
    { f: 'Oliver', l: 'Ward', role: 'Mentor', co: 'ex-Google', city: 'San Francisco', c: 2, circles: ['Mentors'], tags: ['Leadership', 'Scaling'], last: 70, bday: 55, age: 52, met: 1800, place: 'Mentorship programme', tg: 'oliver_ward', phone: '+1 415 555 0144', facts: [{ icon: 'book', text: 'Writing a book on management' }, { icon: 'coffee', text: 'Meetings only before 10am' }], help: 'How to build a C-level team', topics: ['How the book is going', 'Advice on hiring a COO'], gifts: 'Rare editions on the history of management' },
    { f: 'Yuna', l: 'Kim', role: 'Illustrator', co: 'Freelance', city: 'Seoul', c: 4, circles: ['Community'], tags: ['Illustration'], last: 300, bday: 120, met: 380, place: 'Design market', ig: 'yuna.kim.art' },
    { f: 'Stephen', l: 'Orr', role: 'Product Manager', co: 'Quartz', city: 'London', c: 3, circles: ['Work'], tags: ['Product', 'Analytics'], last: 12, bday: 230, met: 200, place: 'Through Ethan', tg: 'stephen_orr', seek: 'A product mentor' },
    { f: 'Leila', l: 'Hassan', role: 'Partner', co: 'Caspian Angels', city: 'Baku', c: 3, circles: ['Investors'], tags: ['Angel', 'Healthtech'], last: 120, bday: 15, age: 41, met: 760, place: 'Web Summit, Lisbon', tg: 'leila_h', email: 'leila@caspian.example', help: 'Healthtech, syndicates', seek: 'Healthtech startups' },
    { f: 'Max', l: 'Dean', role: 'Coach', co: 'Run Club', city: 'London', c: 2, circles: ['Sports', 'Friends'], tags: ['Running', 'Triathlon'], last: 6, bday: 180, met: 950, place: 'Morning run in Hyde Park', tg: 'max_dean', phone: '+44 7700 900 330', facts: [{ icon: 'trophy', text: 'Ironman in 2024' }] },
    { f: 'Anna', l: 'Rivera', role: 'Country Manager', co: 'Delivero', city: 'Barcelona', c: 4, circles: ['Work'], tags: ['Operations', 'Retail'], last: 400, bday: 270, met: 1000, place: 'Case competition', li: 'annarivera' },
    { f: 'Fred', l: 'Vance', role: 'Lawyer', co: 'Vance & Partners', city: 'London', c: 3, circles: ['Clients', 'Work'], tags: ['Law', 'M&A'], last: 88, bday: 140, met: 1200, place: 'Raj’s recommendation', email: 'f.vance@vplaw.example', phone: '+44 20 7946 0030', help: 'Deals, corporate law' },
    { f: 'Rita', l: 'Son', role: 'Founder', co: 'Mochi Tea', city: 'Seoul', c: 3, circles: ['Community'], tags: ['Retail', 'Brand'], last: 140, bday: 70, met: 540, place: 'Founders’ dinner', ig: 'mochi.tea', tg: 'rita_son', seek: 'PR and media for the brand launch' },
    { f: 'Dmitri', l: 'Baxter', role: 'CEO', co: 'Northern Robotics', city: 'Leeds', c: 3, circles: ['Clients'], tags: ['Robotics', 'Hardware'], last: 26, bday: 205, met: 300, place: 'Industry expo', email: 'd.baxter@northernrobotics.example' },
    { f: 'Kate', l: 'Swan', role: 'Sister', co: '', city: 'London', c: 1, circles: ['Family'], tags: ['Dance'], last: 3, bday: 99, age: 27, tg: 'kate_swan', phone: '+44 7700 900 101', facts: [{ icon: 'music', text: 'Dances contemporary' }], gifts: 'A voucher for a dance studio', cadence: 7 },
    { f: 'Peter', l: 'Swan', role: 'Father', co: '', city: 'York', c: 1, circles: ['Family'], tags: ['Fishing', 'History'], last: 19, bday: 160, age: 63, phone: '+44 7700 900 012', facts: [{ icon: 'book', text: 'Collects books on naval history' }], cadence: 7 },
    { f: 'Ari', l: 'Tanner', role: 'Data Scientist', co: 'Lumen Labs', city: 'London', c: 4, circles: ['Work'], tags: ['ML', 'Python'], last: 9, bday: 310, met: 9, place: 'Through Alice', tg: 'ari_tanner' },
    { f: 'Hassan', l: 'Yusuf', role: 'Founder', co: 'Oasis Pay', city: 'Dubai', c: 3, circles: ['Community', 'Clients'], tags: ['Fintech', 'MENA'], last: 100, bday: 60, met: 480, place: 'Gitex, Dubai', tg: 'hassan_y', phone: '+971 50 123 4567', help: 'Payment infrastructure in MENA', seek: 'An investor for the seed round, fintech MENA' },
    { f: 'Olivia', l: 'Crane', role: 'Chief Marketing Officer', co: 'Mint Studio', city: 'Chicago', c: 4, circles: ['Clients'], tags: ['Marketing', 'Brand'], last: 260, bday: 23, met: 700, place: 'Webinar', email: 'olivia@mint.example' },
    { f: 'Glen', l: 'Rowe', role: 'Venture analyst', co: 'Polaris Ventures', city: 'Dubai', c: 4, circles: ['Investors'], tags: ['Venture', 'Analytics'], last: 11, bday: 280, met: 18, place: 'Through Mark', tg: 'glen_rowe' },
    { f: 'Lisa', l: 'Moore', role: 'Designer', co: 'Orbita', city: 'Belgrade', c: 3, circles: ['Work', 'Friends'], tags: ['UX', 'Photography'], last: 20, bday: 190, met: 25, place: 'Through Sofia', ig: 'lisa.moore', tg: 'lisamoore', help: 'UX and mobile design' },
    { f: 'Aslan', l: 'Khan', role: 'Partner', co: 'Peak Ventures', city: 'London', c: 2, circles: ['Investors', 'Mentors'], tags: ['Venture', 'Deep tech', 'Mountains'], last: 150, bday: 45, age: 47, met: 1500, place: 'Fund dinner', tg: 'aslan_khan', email: 'aslan@peak.example', help: 'Deep tech, strong LPs', topics: ['A metrics update', 'Invite to the demo'] },
    { f: 'Victoria', l: 'Zane', role: 'COO', co: 'Fintrack', city: 'Dublin', c: 3, circles: ['Work'], tags: ['Operations', 'Fintech'], last: 37, bday: 220, met: 700, place: 'Hackathon in Dublin', tg: 'vicky_z' },
  ],
  titles: {
    meeting: ['Coffee at Monmouth', 'Breakfast before the conference', 'Lunch downtown', 'Meeting at the office', 'A walk along the river', 'Dinner in Soho'],
    call: ['Partnership call', 'Quick call', 'Call: feedback on the pitch', 'Video call, talked through plans'],
    message: ['Chat on Telegram', 'Congratulated on the launch', 'Sent an article about AI', 'Swapped news'],
    event: ['Web Summit', 'Startup Village', 'Accelerator demo day', 'Founders’ dinner', 'Product meetup'],
    favor_given: ['Introduced to an investor', 'Helped hire a designer', 'Gave feedback on the deck'],
    favor_got: ['Intro to a fund', 'Recommended a lawyer', 'Helped with relocation'],
    gift: ['Gave the book “Hooked”', 'Sent flowers', 'Brought coffee from Ethiopia'],
    note: ['Note'],
  },
  notes: {
    meeting: [
      'Talked about the new product; wants to show a prototype in a month.',
      'A very warm meeting. Agreed to see each other more often.',
      'Told them about our round; promised to think about an intro.',
      'Talked about hiring; looking for a strong product manager.',
      'Recommended “Atomic Habits”, need to send the link.',
    ],
    call: [
      'Discussed the partnership; waiting for our proposal by Friday.',
      'Gave feedback on the pitch deck: cut it to 12 slides.',
      'Quickly synced plans for the quarter.',
    ],
    message: [
      'Congratulated on the launch; the reply was very warm.',
      'Sent an article about AI agents; we will discuss it in person.',
      'Swapped news; invites us to visit in spring.',
    ],
    event: [
      'Bumped into each other in the corridors, agreed on a call.',
      'Sat at the same table and talked a lot about the market.',
    ],
    favor_given: ['Introduced to someone at Polaris; they said thanks.', 'Recommended two strong designers.'],
    favor_got: ['Made an intro to a fund, helped a lot.', 'Recommended a relocation lawyer.'],
    gift: ['Was delighted with the gift.'],
  },
  leads: [
    { f: 'David', l: 'Schwartz', role: 'Managing Partner', co: 'Northwind Capital', city: 'Dubai', why: 'Invests in seed fintech in MENA, looking for strong teams', src: 'Web Summit', tags: ['Investor', 'Fintech'], d: 3, tg: 'dschwartz', ph: '+971 50 214 7788', star: true },
    { f: 'Said', l: 'Al-Mansouri', role: 'Founder of a family office', co: 'Gulf Ventures', city: 'Dubai', why: 'Millionaire: a family office investing in real estate and technology', src: 'Dinner in Dubai', tags: ['Investor', 'Business'], d: 9, ph: '+971 55 303 1122', em: 'office@gulfventures.example', star: true },
    { f: 'Milana', l: 'Orlova', role: 'Lead Product Designer', co: 'Pixel & Co', city: 'London', why: 'Mobile app UX, builds design systems', src: 'Dribbble', tags: ['Design'], d: 12, tg: 'milana_orlova', li: 'https://www.linkedin.com/in/milana-orlova-example' },
    { f: 'George', l: 'Larkin', role: 'Business section editor', co: 'The Daily Business', city: 'New York', why: 'Writes about startups and launches, takes founders’ columns', src: 'Media conference', tags: ['Media'], d: 14, tg: 'g_larkin', em: 'larkin@dailybusiness.example' },
    { f: 'Emma', l: 'Lorenz', role: 'CPO', co: 'Orbit Health', city: 'Berlin', why: 'Mentors on product and growth, runs a product school', src: 'From Alice', tags: ['Product', 'Mentor'], d: 16, li: 'https://www.linkedin.com/in/emma-lorenz-example', star: true },
    { f: 'Anna', l: 'Becker', role: 'Deals lawyer', co: 'Lexa Partners', city: 'London', why: 'Handles M&A and investment rounds, corporate law', src: 'Founders chat', tags: ['Lawyer'], d: 18, tg: 'anna_becker', em: 'a.becker@lexa.example' },
    { f: 'Victor', l: 'Nam', role: 'CTO', co: 'Quantum Labs', city: 'Seoul', why: 'Architect of high-load systems, Rust', src: 'GitHub', tags: ['Engineering', 'AI'], d: 20, li: 'https://www.linkedin.com/in/victor-nam-example' },
    { f: 'Lika', l: 'Garcia', role: 'Head of Talent', co: 'Nova', city: 'Barcelona', why: 'Knows the candidate market in Europe, finds engineers fast', src: 'LinkedIn', tags: ['HR'], d: 21, li: 'https://www.linkedin.com/in/lika-garcia-example' },
    { f: 'Tim', l: 'Rogers', role: 'Founder', co: 'ProLogistics', city: 'London', why: 'Businessman, logistics, revenue over a billion, open to investing in startups', src: 'Founders’ dinner', tags: ['Business', 'Investor'], d: 23, ph: '+44 7700 900 425', star: true },
    { f: 'Irene', l: 'Voronova', role: 'Brand Director', city: 'Tbilisi', why: 'Launches consumer brands, knows every PR agency in town', src: 'From Mark', tags: ['Marketing', 'Media'], d: 26, tg: 'irene_brand' },
    { f: 'Ryan', l: 'Foster', role: 'Partner', co: 'Seed Garden', city: 'London', why: 'Seed and Series A, B2B SaaS, replies fast', src: 'LinkedIn', tags: ['Investor'], d: 28, li: 'https://www.linkedin.com/in/ryan-foster-example', em: 'ryan@seedgarden.example' },
    { f: 'Nurlan', l: 'Abenov', role: 'Head of department', co: 'Ministry of Digital Affairs', city: 'Astana', why: 'Government connections in Kazakhstan, helps with regulation', src: 'Policy forum', tags: ['Government'], d: 31, ph: '+7 701 555 40 40' },
    { f: 'Sophia', l: 'Clark', role: 'Host of the podcast “Founders Talk”', city: 'Lisbon', why: 'Interviews founders, audience of 40 thousand. Knows the expat crowd in Lisbon', src: 'Web Summit', tags: ['Media'], d: 33, tg: 'sophia_clark_pod', star: true },
    { f: 'Dmitri', l: 'Yakhin', role: 'CFO', co: 'Ardis Group', city: 'London', why: 'Financial models, due diligence, tax planning', src: 'From Tim', tags: ['Finance'], d: 35, em: 'yakhin@ardis.example' },
    { f: 'Aliya', l: 'Sarsen', role: 'Product Director', city: 'Almaty', why: 'Scaled a fintech product to 2 million users', src: 'Product chat', tags: ['Product', 'Fintech'], d: 36, tg: 'aliya_pm' },
    { f: 'Max', l: 'Fischer', role: 'Founder', co: 'Alpine Crypto Fund', city: 'Zurich', why: 'Crypto fund, web3 infrastructure, cheques from 500 thousand', src: 'Conference in Zurich', tags: ['Crypto', 'Investor'], d: 38, tg: 'maxfischer_cz' },
    { f: 'Helen', l: 'Martin', role: 'Cardiologist', co: 'Modern Medicine Clinic', city: 'London', why: 'A good doctor just in case, sees patients by recommendation', src: 'From mom', tags: ['Medicine'], d: 40, ph: '+44 20 7946 4567' },
    { f: 'Paul', l: 'Drozd', role: 'Developer', city: 'Dubai', why: 'UAE real estate, ready properties, helps with paperwork', src: 'Relocation chat', tags: ['Real estate'], d: 41, tg: 'drozd_dxb', ph: '+971 52 600 11 99' },
    { f: 'Kim', l: 'Sun-woo', role: 'Venture partner', co: 'Han River Ventures', city: 'Seoul', why: 'The Korean market and entry into Asia, investor', src: 'Web Summit', tags: ['Investor'], d: 44, li: 'https://www.linkedin.com/in/kim-sunwoo-example' },
    { f: 'Oksana', l: 'Lis', role: 'Conference organiser', city: 'London', why: 'Knows all the speakers, hosts stages at AI conferences', src: 'Media conference', tags: ['Events', 'AI'], d: 47, tg: 'oksana_events' },
    { f: 'Arman', l: 'Kasym', role: 'Relocation lawyer', city: 'Dubai', why: 'UAE visas and residency, setting up companies in a Free Zone', src: 'Relocation chat', tags: ['Lawyer'], d: 50, tg: 'arman_visa_uae', em: 'arman@relocate.example' },
    { f: 'Liam', l: 'O’Connor', role: 'Head of AI', co: 'Stealth', city: 'San Francisco', why: 'LLM infrastructure, looking for strong engineers', src: 'LinkedIn', tags: ['AI', 'Engineering'], d: 52, li: 'https://www.linkedin.com/in/liam-oconnor-example' },
    { f: 'Vera', l: 'Kim', role: 'Coach', city: 'Almaty', why: 'Mentoring for founders, helps with burnout and decisions', src: 'Podcast', tags: ['Mentor'], d: 55, tg: 'vera_kim_coach' },
  ],
  relate: byName => {
    byName('Mark').introducedBy = byName('Ethan').id
    byName('Stephen').introducedBy = byName('Ethan').id
    byName('Ari').introducedBy = byName('Alice').id
    byName('Lisa').introducedBy = byName('Sofia').id
    byName('Glen').introducedBy = byName('Mark').id
    byName('Fred').introducedBy = byName('Raj').id
    byName('Alice').links = [{ personId: byName('Ethan').id, label: 'friends since university' }, { personId: byName('Ari').id, label: 'colleagues' }]
    byName('Ethan').links = [{ personId: byName('Alice').id, label: 'friends' }, { personId: byName('Stephen').id, label: 'work together' }]
    byName('Mark').links = [{ personId: byName('Glen').id, label: 'colleagues at the fund' }]
    byName('Daniel').links = [{ personId: byName('Victoria').id, label: 'co-founders' }]
    byName('Kate').links = [{ personId: byName('Peter').id, label: 'daughter' }]
    byName('Peter').links = [{ personId: byName('Kate').id, label: 'father' }]
  },
  extraInteractions: (byName, today, uid) => {
    const ws = today - 120 * 86_400_000
    return [
      { id: uid(), personIds: [byName('Leila').id, byName('Mark').id, byName('Hassan').id], type: 'event', date: ws, title: 'Web Summit: founders’ dinner', place: 'Lisbon', note: 'Sat at the same table and agreed on a call about the MENA market.', createdAt: ws },
      { id: uid(), personIds: [byName('Alice').id], type: 'note', date: today - 2 * 86_400_000, title: 'Note', note: 'Alice is looking for a CTO. Think about who from the network to recommend (Daniel?).', createdAt: today - 2 * 86_400_000 },
    ]
  },
  reminders: (byName, today, now, uid) => [
    { id: uid(), personId: byName('Alice').id, text: 'Introduce her to Daniel: she is looking for a CTO', dueAt: today + 1 * 86_400_000 + 11 * 3600_000, done: false, createdAt: now },
    { id: uid(), personId: byName('Mark').id, text: 'Send the metrics update', dueAt: today + 18 * 3600_000, done: false, createdAt: now },
    { id: uid(), personId: byName('Tim').id, text: 'Wish him a happy birthday', dueAt: today + 2 * 86_400_000 + 10 * 3600_000, done: false, createdAt: now },
    { id: uid(), personId: byName('Oliver').id, text: 'Ask for advice on hiring a COO', dueAt: today + 5 * 86_400_000, done: false, createdAt: now },
    { id: uid(), personId: byName('Eva').id, text: 'Pitch the story of our launch', dueAt: today - 1 * 86_400_000 + 15 * 3600_000, done: false, createdAt: now },
  ],
}
