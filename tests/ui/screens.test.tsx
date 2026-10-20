import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dueContacts } from '@/data/logic'
import { db } from '@/data/db'
import { exportBackup } from '@/data/actions'
import { download } from '@/lib/ics'
import { pickFile } from '@/lib/image'
import { useUI } from '@/app/store'
import { seed, renderApp, watchConsole } from './harness'

vi.mock('@/lib/ics', async orig => ({ ...(await orig<typeof import('@/lib/ics')>()), download: vi.fn() }))
vi.mock('@/lib/image', async orig => ({ ...(await orig<typeof import('@/lib/image')>()), pickFile: vi.fn(), fileToAvatar: vi.fn(async () => 'data:image/jpeg;base64,AVATAR') }))

const dialog = () => screen.findByRole('dialog')
const firstDue = async () => dueContacts(await db.people.toArray())[0].p

describe('главный экран: быстрые действия', () => {
  beforeEach(() => seed({ demo: true }))

  it('«Отметить» записывает контакт и убирает карточку из «ждут»', async () => {
    const { user } = renderApp('/')
    const due = await firstDue()
    const before = (await db.interactions.where('personIds').equals(due.id).count())
    await user.click((await screen.findAllByRole('button', { name: 'Отметить' }))[0])
    await waitFor(async () => expect(await db.interactions.where('personIds').equals(due.id).count()).toBe(before + 1))
    await waitFor(async () => expect((await db.people.get(due.id))?.lastContactAt).toBeGreaterThan(Date.now() - 60_000))
  })

  it('«Отложить на неделю» прячет человека из очереди', async () => {
    const { user } = renderApp('/')
    const due = await firstDue()
    await user.click((await screen.findAllByRole('button', { name: 'Отложить на неделю' }))[0])
    await waitFor(async () => expect((await db.people.get(due.id))?.snoozedUntil).toBeGreaterThan(Date.now() + 6 * 86_400_000))
    expect(dueContacts(await db.people.toArray()).some(x => x.p.id === due.id)).toBe(false)
  })

  it('плитки ведут на «Разбор» и «Пульс»; карточка Астры — в бриф недели', async () => {
    const { user } = renderApp('/')
    await user.click(await screen.findByText('ждут контакта'))
    expect(await screen.findByText('Разбор связей')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await user.click(await screen.findByText(/Астра · бриф недели/))
    expect(await screen.findByText(/БРИФ НЕДЕЛИ|Бриф недели/i)).toBeInTheDocument()
  })

  it('кнопки Астры: «Наговорить», «Диалог», «Событие»', async () => {
    const { user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: 'Наговорить' }))
    expect(await screen.findByText(/Наговори встречу/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await user.click(await screen.findByRole('button', { name: 'Диалог' }))
    expect(await screen.findByPlaceholderText(/Спроси про людей и разговоры/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await user.click(await screen.findByRole('button', { name: 'Событие' }))
    expect(await screen.findByText('Куда идёшь?')).toBeInTheDocument()
  })

  it('поиск: имя, компания, Esc закрывает', async () => {
    const { user } = renderApp('/')
    await screen.findByText(/тонус сети/i)
    await user.click(screen.getByRole('button', { name: 'Поиск' }))
    const input = await screen.findByPlaceholderText(/Найди человека/)
    await user.type(input, 'Lumen')
    expect((await screen.findAllByText('Алина Воронцова')).length).toBeGreaterThan(0)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByPlaceholderText(/Найди человека/)).not.toBeInTheDocument())
  })
})

describe('«Разбор связей»: колода', () => {
  beforeEach(() => seed({ demo: true }))

  it('«Был контакт», «Позже», «Напомнить» меняют данные и двигают колоду до конца', async () => {
    const { user } = renderApp('/review')
    const queue = dueContacts(await db.people.toArray()).map(x => x.p)
    expect(queue.length).toBeGreaterThan(3)
    await screen.findByText(new RegExp(`1/${queue.length}`))
    await user.click(await screen.findByRole('button', { name: 'Был контакт' }))
    await waitFor(async () => expect((await db.interactions.where('personIds').equals(queue[0].id).toArray()).some(i => i.type === 'message')).toBe(true))
    await user.click(await screen.findByRole('button', { name: 'Позже' }))
    await waitFor(async () => expect((await db.people.get(queue[1].id))?.snoozedUntil).toBeGreaterThan(Date.now()))
    await user.click(await screen.findByRole('button', { name: 'Напомнить' }))
    await waitFor(async () => expect((await db.reminders.where('personId').equals(queue[2].id).toArray()).length).toBe(1))
    for (let i = 3; i < queue.length; i++) await user.click(await screen.findByRole('button', { name: 'Позже' }))
    expect(await screen.findByText('Колода разобрана')).toBeInTheDocument()
    expect(screen.getByText(/Отмечено: 1 · отложено: \d+ · напомню: 1/)).toBeInTheDocument()
  })
})

describe('режим события', () => {
  beforeEach(() => seed({ demo: true }))

  it('от старта до сохранения: люди, общие напоминания «фоллоу-ап», событие закрывается', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/event')
    const peopleBefore = await db.people.count()
    await user.type(await screen.findByPlaceholderText('Web Summit 2026'), 'Конференция Икс')
    await user.click(screen.getByRole('button', { name: 'Начать событие' }))
    const note = await screen.findByPlaceholderText(/Имя, чем занимается/)
    await user.type(note, 'Фёдор Новиков, основатель в Notion, договорились созвониться')
    await user.click(screen.getByRole('button', { name: /Следующий/ }))
    await waitFor(async () => expect(await db.captures.count()).toBe(1))
    await user.type(await screen.findByPlaceholderText(/Имя, чем занимается/), 'Ирина Козлова, дизайнер')
    await user.click(screen.getByRole('button', { name: /Разобрать/ }))
    expect(await screen.findByText('Кого поймали', undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Фёдор')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Ирина')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Сохранить 2/ }))
    await waitFor(async () => expect(await db.people.count()).toBe(peopleBefore + 2), { timeout: 5000 })
    expect((await db.events.toArray())[0]).toMatchObject({ name: 'Конференция Икс' })
    await waitFor(async () => expect((await db.events.toArray())[0].endedAt).toBeGreaterThan(0))
    const reminders = await db.reminders.filter(r => r.text.includes('Фоллоу-ап')).toArray()
    expect(reminders).toHaveLength(2)
    expect((await db.captures.toArray()).every(c => c.status === 'saved')).toBe(true)
    expect((await db.people.filter(p => p.metPlace === 'Конференция Икс').toArray()).length).toBe(2)
    expect(bad).toEqual([])
  })

  it('можно убрать запись из «плёнки» и отключить человека на проверке', async () => {
    const { user } = renderApp('/event')
    await user.type(await screen.findByPlaceholderText('Web Summit 2026'), 'Ужин')
    await user.click(screen.getByRole('button', { name: 'Начать событие' }))
    await user.type(await screen.findByPlaceholderText(/Имя, чем занимается/), 'Пётр Сидоров, инвестор')
    await user.click(screen.getByRole('button', { name: /Следующий/ }))
    await user.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(async () => expect(await db.captures.count()).toBe(0))
  })

  it('«Начать событие» недоступно без названия', async () => {
    renderApp('/event')
    expect(await screen.findByRole('button', { name: 'Начать событие' })).toBeDisabled()
  })
})

describe('профиль: данные и настройки', () => {
  beforeEach(() => seed({ demo: true }))

  it('имя меняется по Enter и сохраняется', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Макс'))
    const input = await screen.findByDisplayValue('Макс')
    await user.clear(input)
    await user.type(input, 'Максим{Enter}')
    await waitFor(async () => expect((await db.settings.get('me'))?.name).toBe('Максим'))
  })

  it('фото профиля: выбор файла сохраняет аватар', async () => {
    vi.mocked(pickFile).mockResolvedValueOnce(new File(['x'], 'me.jpg', { type: 'image/jpeg' }))
    const { user } = renderApp('/me')
    await user.click(await screen.findByRole('button', { name: 'Сменить фото' }))
    await waitFor(async () => expect((await db.settings.get('me'))?.photo).toBe('data:image/jpeg;base64,AVATAR'))
  })

  it('«Добавить из копии» объединяет, «Восстановить из копии» заменяет', async () => {
    const backup = JSON.parse(JSON.stringify(await exportBackup()))
    const extra = { id: 'only-in-db', firstName: 'Лишний', circleIds: [], tags: [], closeness: 3, channels: [], facts: [], topics: [], links: [], createdAt: 1, updatedAt: 1 }
    await db.people.put(extra as never)
    const file = () => new File([JSON.stringify(backup)], 'backup.json')
    const { user } = renderApp('/me')
    vi.mocked(pickFile).mockResolvedValueOnce(file())
    await user.click(await screen.findByText('Добавить из копии'))
    await screen.findByText(/Добавлено из копии/)
    expect(await db.people.get('only-in-db')).toBeDefined()
    vi.mocked(pickFile).mockResolvedValueOnce(file())
    await user.click(await screen.findByText('Восстановить из копии'))
    await waitFor(async () => expect(await db.people.get('only-in-db')).toBeUndefined())
  })

  it('битый файл копии — сообщение, данные целы', async () => {
    const before = await db.people.count()
    vi.mocked(pickFile).mockResolvedValueOnce(new File(['это не json'], 'x.json'))
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Восстановить из копии'))
    expect(await screen.findByText(/не похож на резервную копию/)).toBeInTheDocument()
    expect(await db.people.count()).toBe(before)
  })

  it('экспорт контактов (.vcf) и резерва (.csv)', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Экспорт контактов (.vcf)'))
    expect(vi.mocked(download).mock.calls.at(-1)?.[0]).toBe('aster-contacts.vcf')
    expect(String(vi.mocked(download).mock.calls.at(-1)?.[1]).match(/BEGIN:VCARD/g)?.length).toBe(32)
    await user.click(await screen.findByText('Экспорт резерва (.csv)'))
    await waitFor(() => expect(vi.mocked(download).mock.calls.at(-1)?.[0]).toBe('aster-reserve.csv'))
  })

  it('«Удалить все данные» требует второго нажатия и возвращает на онбординг', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Удалить все данные'))
    expect(await db.people.count()).toBe(32)
    await user.click(await screen.findByText(/Точно удалить всё/))
    await waitFor(async () => expect(await db.people.count()).toBe(0))
    expect(await screen.findByRole('button', { name: 'Начать' })).toBeInTheDocument()
  })

  it('«Загрузить демо-данные» заменяет текущие', async () => {
    await db.people.clear()
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Загрузить демо-данные'))
    await waitFor(async () => expect(await db.people.count()).toBe(32), { timeout: 8000 })
  })

  it('«Круги», «Пульс» и «Астра» открываются из профиля', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Пульс сети'))
    expect(await screen.findByText('Сегодня против обычного')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await user.click(await screen.findByText('Круги'))
    expect(await dialog()).toBeInTheDocument()
    useUI.getState().close()
  })
})

describe('орбита, пульс, бриф недели', () => {
  beforeEach(() => seed({ demo: true }))

  it('орбита: фильтр по кругу, выбор человека, «Профиль», режим «Созвездия»', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/orbit')
    await screen.findByText(/ЧЕЛОВЕК|человек/i)
    await user.click(await screen.findByRole('button', { name: /Работа/ }))
    await user.click(await screen.findByRole('button', { name: /Созвездия/ }))
    await user.click(await screen.findByRole('button', { name: /^Все$/ }))
    const dots = screen.getAllByRole('button').filter(b => b.getAttribute('aria-label')?.match(/^[А-Я][а-я]+ [А-Я]/))
    expect(dots.length).toBeGreaterThan(10)
    await user.click(dots[0])
    await user.click(await screen.findByRole('button', { name: /Профиль/ }))
    expect(window.location.hash).toMatch(/^#\/person\//)
    expect(bad).toEqual([])
  })

  it('пульс: метрики, круги, кольцо ближнего круга', async () => {
    renderApp('/pulse')
    expect(await screen.findByText('Контакты за неделю')).toBeInTheDocument()
    expect(screen.getByText('Новые знакомства за месяц')).toBeInTheDocument()
    expect(screen.getByText('Связи в ритме')).toBeInTheDocument()
    expect(await screen.findByText('Круги')).toBeInTheDocument()
    expect(await screen.findByText('Орбиты')).toBeInTheDocument()
  })

  it('бриф недели: заголовок, статистика, приоритеты ведут к людям', async () => {
    const { user } = renderApp('/weekly')
    expect(await screen.findByText('Главное на неделе')).toBeInTheDocument()
    expect(screen.getByText('Дни рождения')).toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: 'Написать' }))[0])
    expect(await dialog()).toBeInTheDocument()
  })
})
