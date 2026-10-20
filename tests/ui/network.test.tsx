import { screen, waitFor, within } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { db } from '@/data/db'
import { importBackup, saveSettings, exportBackup } from '@/data/actions'
import { DAY } from '@/lib/format'
import { download } from '@/lib/ics'
import { seed, renderApp, watchConsole } from './harness'

// скачивание файла в happy-dom «переходит» по blob-ссылке и ломает роутер — подменяем на шпиона
vi.mock('@/lib/ics', async orig => ({ ...(await orig<typeof import('@/lib/ics')>()), download: vi.fn() }))
const downloaded = () => vi.mocked(download).mock.calls

const dialog = () => screen.findByRole('dialog')
const personByName = async (name: string) => (await db.people.filter(p => p.firstName === name).first())!

describe('новый человек', () => {
  beforeEach(() => seed({ demo: true }))

  it('«Новый человек» из меню «+» → карточка в базе и переход в профиль', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/people')
    await screen.findByText('Алина Воронцова')
    await user.click(screen.getAllByRole('button', { name: 'Добавить' })[0])
    await user.click((await screen.findByText('Сохранить знакомство')).closest('button') as HTMLElement)
    const d = within(await dialog())
    await user.type(d.getByPlaceholderText('Имя'), 'Тестовый')
    await user.type(d.getByPlaceholderText('Фамилия'), 'Человек')
    await user.click(d.getByRole('button', { name: 'Добавить в сеть' }))
    await waitFor(async () => expect(await db.people.filter(p => p.firstName === 'Тестовый').count()).toBe(1))
    expect(window.location.hash).toMatch(/^#\/person\//)
    expect((await screen.findAllByText('Тестовый Человек')).length).toBeGreaterThan(0)
    expect(bad).toEqual([])
  })

  it('без имени «Добавить в сеть» недоступно', async () => {
    const { user } = renderApp('/people')
    await screen.findByText('Алина Воронцова')
    await user.click(screen.getAllByRole('button', { name: 'Добавить' })[0])
    await user.click((await screen.findByText('Сохранить знакомство')).closest('button') as HTMLElement)
    expect(within(await dialog()).getByRole('button', { name: 'Добавить в сеть' })).toBeDisabled()
  })
})

describe('профиль человека', () => {
  beforeEach(() => seed({ demo: true }))

  it('«Записать» → тип, заметка → «Сохранить»: в хронологии появляется запись и обновляется последний контакт', async () => {
    const nina = await personByName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await screen.findAllByText('Нина Чернова')
    const before = (await db.people.get(nina.id))?.lastContactAt ?? 0
    await user.click(await screen.findByRole('button', { name: 'Записать' }))
    const d = within(await dialog())
    await user.click(d.getByRole('button', { name: 'Звонок' }))
    await user.type(d.getByPlaceholderText(/Новости, договорённости/), 'Обсудили переезд в Порту')
    await user.click(d.getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => expect(((await db.people.get(nina.id))?.lastContactAt ?? 0)).toBeGreaterThan(before))
    const it = (await db.interactions.where('personIds').equals(nina.id).toArray()).find(i => i.note === 'Обсудили переезд в Порту')
    expect(it).toMatchObject({ type: 'call' })
    await user.click(screen.getByRole('button', { name: 'История' }))
    expect(await screen.findByText('Обсудили переезд в Порту')).toBeInTheDocument()
  })

  it('следующий шаг при записи контакта создаёт напоминание', async () => {
    const nina = await personByName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: 'Записать' }))
    const d = within(await dialog())
    await user.click(d.getByRole('button', { name: /Через неделю|Через 7/ }))
    await user.type(d.getByPlaceholderText(/Что сделать/), 'Отправить презентацию')
    await user.click(d.getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => expect((await db.reminders.filter(r => r.text === 'Отправить презентацию').toArray()).length).toBe(1))
    const r = (await db.reminders.filter(r => r.text === 'Отправить презентацию').first())!
    expect(r.personId).toBe(nina.id)
    expect(r.dueAt - Date.now()).toBeGreaterThan(6 * DAY)
  })

  it('«Напомнить» создаёт напоминание с выбранным сроком', async () => {
    const nina = await personByName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: 'Напомнить' }))
    const d = within(await dialog())
    await user.type(await d.findByPlaceholderText(/Связаться: Нина/), 'Спросить про клинику')
    await user.click(d.getByRole('button', { name: 'Через 3 дня' }))
    await user.click(d.getByRole('button', { name: 'Напомнить' }))
    await waitFor(async () => expect(await db.reminders.filter(r => r.text === 'Спросить про клинику').count()).toBe(1))
  })

  it('меню «Ещё»: удаление человека убирает его и возвращает к списку', async () => {
    const nina = await personByName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: 'Ещё' }))
    await user.click(await screen.findByRole('button', { name: /Удалить навсегда/ }))
    const confirm = await screen.findByRole('button', { name: /Точно|Да, удалить|подтверд/i }).catch(() => null)
    if (confirm) await user.click(confirm)
    await waitFor(async () => expect(await db.people.get(nina.id)).toBeUndefined())
  })

  it('избранное переключается', async () => {
    const nina = await personByName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: 'В избранные' }))
    await waitFor(async () => expect((await db.people.get(nina.id))?.pinned).toBe(true))
  })
})

describe('«Наговорить встречу» (текстом)', () => {
  beforeEach(() => seed({ demo: true }))
  it('текст → разбор → «Сохранить всё» → человек, запись и напоминание', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/capture')
    const box = await screen.findByPlaceholderText(/Например|Расскажи|Что произошло/i).catch(() => screen.findByRole('textbox'))
    await user.click(box)
    await user.paste('Познакомился с Артёмом Беловым на ужине у Алины — он CTO в финтехе. Договорились созвониться в пятницу.')
    await user.click(await screen.findByRole('button', { name: /Разобрать/ }))
    expect(await screen.findByText(/Вот что я поняла/i)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Сохранить всё' }))
    // приложение пишет человека, запись общения и напоминания последовательно — ждём всех троих
    await waitFor(async () => {
      const p = await db.people.filter(x => x.firstName === 'Артём').first()
      expect(p).toBeTruthy()
      expect(await db.interactions.where('personIds').equals((p as { id: string }).id).count()).toBe(1)
      expect(await db.reminders.filter(r => r.personId === (p as { id: string }).id).count()).toBe(1)
    }, { timeout: 5000 })
    expect(await personByName('Артём')).toMatchObject({ lastName: 'Белов', role: 'CTO' })
    expect(bad).toEqual([])
  })
})

describe('«Сводник»', () => {
  beforeEach(() => seed({ demo: true }))
  it('пары для знакомства; «Не подходит» убирает пару и запоминает выбор', async () => {
    const { user } = renderApp('/intros')
    const first = (await screen.findAllByRole('button', { name: 'Не подходит' }))[0]
    const reason = first.closest('.glow-card')?.querySelector('p')?.textContent as string
    expect(reason).toBeTruthy()
    await user.click(first)
    // на место скрытой пары встаёт следующая, поэтому проверяем исчезновение именно этой
    await waitFor(() => expect(screen.queryByText(reason)).not.toBeInTheDocument())
    expect((await db.intros.toArray()).some(i => i.status === 'dismissed')).toBe(true)
  })
})

describe('резервные копии в приложении', () => {
  it('Профиль → «Резервная копия» скачивает файл и запоминает дату', async () => {
    await seed({ demo: true })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Резервная копия'))
    await waitFor(() => expect(downloaded()).toHaveLength(1))
    expect(downloaded()[0][0]).toMatch(/^aster-backup-\d{4}-\d{2}-\d{2}\.json$/)
    expect(JSON.parse(downloaded()[0][1] as string).app).toBe('aster')
    expect((await db.settings.get('me'))?.lastBackupAt).toBeGreaterThan(0)
    expect(await screen.findByText(/последняя/)).toBeInTheDocument()
  })

  it('напоминание о копии на главном экране: показывается, скачивает, закрывается', async () => {
    await seed({ demo: true })
    const { user } = renderApp('/')
    expect(await screen.findByText(/Данные живут только на этом устройстве/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))
    await waitFor(() => expect(downloaded()).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText(/Данные живут только на этом устройстве/)).not.toBeInTheDocument())
  })

  it('«Напомнить позже» откладывает напоминание на две недели', async () => {
    await seed({ demo: true })
    const { user } = renderApp('/')
    await screen.findByText(/Данные живут только на этом устройстве/)
    await user.click(screen.getByRole('button', { name: 'Напомнить позже' }))
    await waitFor(async () => expect(((await db.settings.get('me'))?.backupSnoozeUntil ?? 0)).toBeGreaterThan(Date.now() + 13 * DAY))
  })

  it('новичку (мало людей или свежая установка) копию не навязывает', async () => {
    await seed({})
    renderApp('/')
    await screen.findByText('Твоя вселенная пока пуста')
    expect(screen.queryByText(/Данные живут только на этом устройстве/)).not.toBeInTheDocument()
  })

  it('битый файл при восстановлении не стирает данные', async () => {
    await seed({ demo: true })
    const before = await db.people.count()
    await expect(importBackup({ app: 'aster', people: [{ id: 'x' }] })).rejects.toThrow()
    expect(await db.people.count()).toBe(before)
    const data = JSON.parse(JSON.stringify(await exportBackup()))
    await saveSettings({ name: 'Другое' })
    await importBackup(data, { mode: 'merge' })
    expect(await db.people.count()).toBe(before)
  })
})

describe('сеть безопасности: ErrorBoundary', () => {
  class Bomb extends Component<{ armed: boolean; children?: ReactNode }> {
    render() { if (this.props.armed) throw new Error('Тестовый взрыв'); return <div>цел и невредим</div> }
  }
  it('вместо белого экрана показывает сообщение и кнопки; данные не страдают', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><Bomb armed /></ErrorBoundary>)
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument()
    expect(screen.getByText(/Твои данные на месте/)).toBeInTheDocument()
    expect(screen.getByText('Тестовый взрыв')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Перезагрузить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить копию данных' })).toBeInTheDocument()
  })
  it('без ошибки не вмешивается', () => {
    render(<ErrorBoundary><Bomb armed={false} /></ErrorBoundary>)
    expect(screen.getByText('цел и невредим')).toBeInTheDocument()
  })
  it('«Сохранить копию данных» скачивает файл', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await seed({ demo: true })
    const { default: userEvent } = await import('@testing-library/user-event')
    render(<ErrorBoundary inline><Bomb armed /></ErrorBoundary>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Сохранить копию данных' }))
    await waitFor(() => expect(downloaded()).toHaveLength(1))
    expect(await screen.findByText(/Копия сохранена/)).toBeInTheDocument()
  })
})
