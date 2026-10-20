import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI, type SheetState } from '@/app/store'
import { db } from '@/data/db'
import { openChannel } from '@/lib/contact'
import { seed, renderApp, watchConsole } from './harness'

vi.mock('@/lib/contact', async orig => ({ ...(await orig<typeof import('@/lib/contact')>()), openChannel: vi.fn() }))

const dialog = () => screen.findByRole('dialog')
const open = (s: Exclude<SheetState, null>) => act(() => useUI.getState().open(s))
const byName = async (name: string) => (await db.people.filter(p => p.firstName === name).first())!

describe('Астра: подключение модели', () => {
  beforeEach(() => seed({ demo: true }))

  it('режимы, ключ, согласие и модель сохраняются; проверка недоступна без согласия', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/me')
    await screen.findByText('Профиль')
    await user.click(await screen.findByText('Астра'))
    const d = within(await dialog())
    expect(d.getByText('Работает на устройстве')).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Свой ключ' }))
    const key = await d.findByPlaceholderText('sk-ant-…')
    expect(key).toHaveAttribute('type', 'password')
    await user.click(d.getByRole('button', { name: 'Показать' }))
    expect(key).toHaveAttribute('type', 'text')
    await user.type(key, 'sk-ant-test')
    expect(d.getByRole('button', { name: 'Проверить подключение' })).toBeDisabled()
    await user.click(d.getByText('Понимаю, как обрабатываются данные'))
    await waitFor(() => expect(d.getByRole('button', { name: 'Проверить подключение' })).toBeEnabled())
    await user.click(d.getByText('Claude Sonnet 5.5'))
    await user.click(d.getByText('Искать новости о людях'))
    await waitFor(async () => {
      const ai = (await db.settings.get('me'))?.ai
      expect(ai).toMatchObject({ mode: 'key', apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5', webSearch: true })
      expect(ai?.consentAt).toBeGreaterThan(0)
    })
    expect((await screen.findAllByText(/Подключена/)).length).toBeGreaterThan(0)
    expect(bad).toEqual([])
  })

  it('режим «Прокси» (скрыт, пока не выбран) просит адрес и токен', async () => {
    const me = (await db.settings.get('me'))!
    await db.settings.put({ ...me, ai: { mode: 'proxy', model: 'claude-opus-5-5', shareNotes: true, webSearch: false } })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Астра'))
    const d = within(await dialog())
    expect(d.getByRole('button', { name: 'Прокси' })).toBeInTheDocument()
    expect(await d.findByPlaceholderText(/aster.example.com/)).toBeInTheDocument()
    expect(d.getByPlaceholderText('пароль к серверу')).toHaveAttribute('type', 'password')
  })

  it('«Устройство» скрывает настройки облака, снятие согласия выключает Астру', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Астра'))
    const d = within(await dialog())
    await user.click(d.getByRole('button', { name: 'Свой ключ' }))
    await user.type(await d.findByPlaceholderText('sk-ant-…'), 'k')
    await user.click(d.getByText('Понимаю, как обрабатываются данные'))
    await waitFor(async () => expect((await db.settings.get('me'))?.ai?.consentAt).toBeDefined())
    await user.click(d.getByText('Понимаю, как обрабатываются данные'))
    await waitFor(async () => expect((await db.settings.get('me'))?.ai?.consentAt).toBeUndefined())
    await user.click(d.getByRole('button', { name: 'Устройство' }))
    await waitFor(() => expect(d.queryByPlaceholderText('sk-ant-…')).not.toBeInTheDocument())
  })
})

describe('Круги', () => {
  beforeEach(() => seed({ demo: true }))
  it('новый круг, переименование, порядок, цвет, удаление снимает круг с людей', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Круги'))
    const d = within(await dialog())
    const before = await db.circles.count()
    await user.click(d.getByRole('button', { name: 'Новый круг' }))
    await waitFor(async () => expect(await db.circles.count()).toBe(before + 1))
    const input = await d.findByDisplayValue('Новый круг')
    await user.clear(input)
    await user.type(input, 'Соседи')
    expect(input).toHaveValue('Соседи') // буквы не теряются, пока запись в базу «догоняет»
    await waitFor(async () => expect((await db.circles.filter(c => c.name === 'Соседи').count())).toBe(1))
    await user.click(await d.findByRole('button', { name: 'Океан' }))
    await waitFor(async () => expect((await db.circles.filter(c => c.name === 'Соседи').first())?.palette).toBe('ocean'))
    // порядок: поднять вверх
    const circle = (await db.circles.filter(c => c.name === 'Соседи').first())!
    await user.click(d.getAllByRole('button', { name: 'Выше' })[d.getAllByRole('button', { name: 'Выше' }).length - 1])
    await waitFor(async () => expect((await db.circles.get(circle.id))?.order).toBeLessThan(before))
    // удаление
    const work = (await db.circles.filter(c => c.name === 'Работа').first())!
    expect(await db.people.where('circleIds').equals(work.id).count()).toBeGreaterThan(0)
    await user.click(d.getAllByRole('button', { name: 'Удалить круг' })[0])
    await waitFor(async () => expect(await db.circles.get(work.id)).toBeUndefined())
    await waitFor(async () => expect(await db.people.where('circleIds').equals(work.id).count()).toBe(0))
  })
})

describe('Знакомство: шторка «Познакомить»', () => {
  beforeEach(() => seed({ demo: true }))
  it('три сообщения; «Отправить» копирует и помечает пару как «спросили»; «Познакомлены» создаёт связь', async () => {
    const hasan = await byName('Хасан')
    const mark = await byName('Марк')
    const { user } = renderApp('/')
    await screen.findByText(/тонус сети/i)
    open({ kind: 'intro', aId: hasan.id, bId: mark.id, reason: 'Хасан ищет инвестора', value: 'Взаимная польза' })
    const d = within(await dialog())
    const box = await d.findByRole('textbox')
    expect((box as HTMLTextAreaElement).value).toContain('Хасан')
    await user.click(d.getByRole('button', { name: 'Марк' }))
    await waitFor(() => expect((d.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Марк'))
    await user.click(d.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(openChannel).toHaveBeenCalled())
    await waitFor(async () => expect((await db.intros.toArray())[0]?.status).toBe('asked'))
    open({ kind: 'intro', aId: hasan.id, bId: mark.id, reason: 'Хасан ищет инвестора', value: 'Взаимная польза' })
    await user.click(await within(await dialog()).findByRole('button', { name: 'Познакомлены' }))
    await waitFor(async () => expect((await db.intros.toArray())[0]?.status).toBe('done'))
    await waitFor(async () => expect((await db.people.get(hasan.id))?.links.some(l => l.personId === mark.id)).toBe(true))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Импорт .vcf', () => {
  beforeEach(() => seed({ demo: true }))
  const vcf = ['BEGIN:VCARD', 'FN:Новая Контактова', 'TEL:+7 900 111 22 33', 'END:VCARD', 'BEGIN:VCARD', 'FN:Алина Воронцова', 'END:VCARD'].join('\r\n')
  it('показывает найденные, пропускает уже существующих по имени и добавляет остальных', async () => {
    const { user } = renderApp('/')
    await screen.findByText(/тонус сети/i)
    const before = await db.people.count()
    open({ kind: 'importVcf', text: vcf })
    const d = within(await dialog())
    expect(await d.findByText(/Нашёл 2 контакта, новых — 1/)).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Добавить 1' }))
    await waitFor(async () => expect(await db.people.count()).toBe(before + 1))
    const added = await db.people.filter(p => p.firstName === 'Новая').first()
    expect(added).toMatchObject({ lastName: 'Контактова', closeness: 4 })
  })
  it('пустой файл — понятное сообщение и неактивная кнопка', async () => {
    renderApp('/')
    await screen.findByText(/тонус сети/i)
    open({ kind: 'importVcf', text: 'ничего' })
    const d = within(await dialog())
    expect(await d.findByText('В файле нет контактов')).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Добавить 0' })).toBeDisabled()
  })
})

describe('Бриф и черновик', () => {
  beforeEach(() => seed({ demo: true }))
  it('бриф перед встречей собирается из карточки', async () => {
    const nina = await byName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: 'Бриф' }))
    const d = within(await dialog())
    expect(await d.findByText(/Нина — /)).toBeInTheDocument()
  })

  it('черновик: тоны, правка текста, «Написать» открывает канал и предлагает записать контакт', async () => {
    const nina = await byName('Нина')
    renderApp('/')
    await screen.findByText(/тонус сети/i)
    open({ kind: 'draft', personId: nina.id })
    const d = within(await dialog())
    const box = (await d.findByRole('textbox')) as HTMLTextAreaElement
    expect(box.value).toContain('Нина')
    const warm = box.value
    await userEventFor().click(d.getByRole('button', { name: 'Коротко' }))
    await waitFor(() => expect((d.getByRole('textbox') as HTMLTextAreaElement).value).not.toBe(warm))
    await userEventFor().click(d.getByRole('button', { name: /Написать в Telegram/ }))
    expect(openChannel).toHaveBeenCalledWith(expect.objectContaining({ type: 'telegram' }))
    const done = await screen.findByRole('button', { name: 'Отправлено' })
    await userEventFor().click(done)
    await waitFor(async () => expect((await db.interactions.where('personIds').equals(nina.id).toArray()).some(i => i.type === 'message' && i.note)).toBe(true))
  })
})

describe('Карточка человека: редактирование', () => {
  beforeEach(() => seed({ demo: true }))
  it('меняет поля, добавляет канал, тег и ритм; «Сохранить» пишет в базу', async () => {
    const bad = watchConsole()
    const nina = await byName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await screen.findAllByText('Нина Чернова')
    await user.click(screen.getAllByRole('button', { name: 'Изменить' })[0])
    const d = within(await dialog())
    const company = await d.findByPlaceholderText('Где работает')
    await user.clear(company)
    await user.type(company, 'Новая компания')
    await user.click(d.getByRole('button', { name: /Email|Почта/ }).closest('button') as HTMLElement)
    await user.type(d.getByPlaceholderText('name@mail.com'), 'nina@new.io')
    await user.click(d.getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => {
      const p = await db.people.get(nina.id)
      expect(p?.company).toBe('Новая компания')
      expect(p?.channels.some(c => c.type === 'email' && c.value === 'nina@new.io')).toBe(true)
    })
    expect(bad).toEqual([])
  })

  it('смена ритма на карточке', async () => {
    const nina = await byName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: /Ритм общения/ }))
    await user.click(await screen.findByRole('button', { name: 'Раз в месяц' }))
    await waitFor(async () => expect((await db.people.get(nina.id))?.cadenceDays).toBe(30))
    await user.click(await screen.findByRole('button', { name: /Ритм общения/ }))
    await user.click(await screen.findByRole('button', { name: 'Без ритма' }))
    await waitFor(async () => expect((await db.people.get(nina.id))?.cadenceDays).toBe(0))
  })
})

function userEventFor() {
  if (!userEventModule) userEventModule = createUser()
  return userEventModule
}
let userEventModule: ReturnType<typeof createUser> | undefined
import userEvent from '@testing-library/user-event'
function createUser() { return userEvent.setup({ pointerEventsCheck: 0 }) }
