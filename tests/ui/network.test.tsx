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

// a file download in happy-dom "navigates" to the blob link and breaks the router: replace it with a spy
vi.mock('@/lib/ics', async orig => ({ ...(await orig<typeof import('@/lib/ics')>()), download: vi.fn() }))
const downloaded = () => vi.mocked(download).mock.calls

const dialog = () => screen.findByRole('dialog')
const personByName = async (name: string) => (await db.people.filter(p => p.firstName === name).first())!

describe('a new person', () => {
  beforeEach(() => seed({ demo: true }))

  it('"New person" from the "+" menu → a card in the database and a move to the profile', async () => {
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

  it('without a name "Add to the network" is unavailable', async () => {
    const { user } = renderApp('/people')
    await screen.findByText('Алина Воронцова')
    await user.click(screen.getAllByRole('button', { name: 'Добавить' })[0])
    await user.click((await screen.findByText('Сохранить знакомство')).closest('button') as HTMLElement)
    expect(within(await dialog()).getByRole('button', { name: 'Добавить в сеть' })).toBeDisabled()
  })
})

describe('a person\'s profile', () => {
  beforeEach(() => seed({ demo: true }))

  it('"Log" → type, note → "Save": a record appears in the timeline and the last contact is updated', async () => {
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

  it('the next step when logging contact creates a reminder', async () => {
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

  it('"Remind" creates a reminder with the chosen due date', async () => {
    const nina = await personByName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: 'Напомнить' }))
    const d = within(await dialog())
    await user.type(await d.findByPlaceholderText(/Связаться: Нина/), 'Спросить про клинику')
    await user.click(d.getByRole('button', { name: 'Через 3 дня' }))
    await user.click(d.getByRole('button', { name: 'Напомнить' }))
    await waitFor(async () => expect(await db.reminders.filter(r => r.text === 'Спросить про клинику').count()).toBe(1))
  })

  it('the "More" menu: deleting a person removes them and returns to the list', async () => {
    const nina = await personByName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: 'Ещё' }))
    await user.click(await screen.findByRole('button', { name: /Удалить навсегда/ }))
    const confirm = await screen.findByRole('button', { name: /Точно|Да, удалить|подтверд/i }).catch(() => null)
    if (confirm) await user.click(confirm)
    await waitFor(async () => expect(await db.people.get(nina.id)).toBeUndefined())
  })

  it('the favourite toggles', async () => {
    const nina = await personByName('Нина')
    const { user } = renderApp(`/person/${nina.id}`)
    await user.click(await screen.findByRole('button', { name: 'В избранные' }))
    await waitFor(async () => expect((await db.people.get(nina.id))?.pinned).toBe(true))
  })
})

describe('"Dictate a meeting" (by text)', () => {
  beforeEach(() => seed({ demo: true }))
  it('text → parse → "Save all" → a person, a record and a reminder', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/capture')
    const box = await screen.findByPlaceholderText(/Например|Расскажи|Что произошло/i).catch(() => screen.findByRole('textbox'))
    await user.click(box)
    await user.paste('Познакомился с Артёмом Беловым на ужине у Алины — он CTO в финтехе. Договорились созвониться в пятницу.')
    await user.click(await screen.findByRole('button', { name: /Разобрать/ }))
    expect(await screen.findByText(/Вот что я поняла/i)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Сохранить всё' }))
    // the app writes the person, the interaction and the reminder one after another: wait for all three
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

describe('the "Matchmaker"', () => {
  beforeEach(() => seed({ demo: true }))
  it('pairs for introductions; "Not a fit" removes a pair and remembers the choice', async () => {
    const { user } = renderApp('/intros')
    const first = (await screen.findAllByRole('button', { name: 'Не подходит' }))[0]
    const reason = first.closest('.glow-card')?.querySelector('p')?.textContent as string
    expect(reason).toBeTruthy()
    await user.click(first)
    // the next pair takes the place of the hidden one, so we check that exactly this one disappears
    await waitFor(() => expect(screen.queryByText(reason)).not.toBeInTheDocument())
    expect((await db.intros.toArray()).some(i => i.status === 'dismissed')).toBe(true)
  })
})

describe('backups in the app', () => {
  it('Profile → "Backup" downloads a file and remembers the date', async () => {
    await seed({ demo: true })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Резервная копия'))
    await waitFor(() => expect(downloaded()).toHaveLength(1))
    expect(downloaded()[0][0]).toMatch(/^aster-backup-\d{4}-\d{2}-\d{2}\.json$/)
    expect(JSON.parse(downloaded()[0][1] as string).app).toBe('aster')
    expect((await db.settings.get('me'))?.lastBackupAt).toBeGreaterThan(0)
    expect(await screen.findByText(/последняя/)).toBeInTheDocument()
  })

  it('the backup reminder on the home screen: shown, downloads, can be closed', async () => {
    await seed({ demo: true })
    const { user } = renderApp('/')
    expect(await screen.findByText(/Данные живут только на этом устройстве/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))
    await waitFor(() => expect(downloaded()).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText(/Данные живут только на этом устройстве/)).not.toBeInTheDocument())
  })

  it('"Remind later" postpones the reminder by two weeks', async () => {
    await seed({ demo: true })
    const { user } = renderApp('/')
    await screen.findByText(/Данные живут только на этом устройстве/)
    await user.click(screen.getByRole('button', { name: 'Напомнить позже' }))
    await waitFor(async () => expect(((await db.settings.get('me'))?.backupSnoozeUntil ?? 0)).toBeGreaterThan(Date.now() + 13 * DAY))
  })

  it('a newcomer (few people or a fresh install) is not pushed to make a backup', async () => {
    await seed({})
    renderApp('/')
    await screen.findByText('Твоя вселенная пока пуста')
    expect(screen.queryByText(/Данные живут только на этом устройстве/)).not.toBeInTheDocument()
  })

  it('a broken file on restore does not erase the data', async () => {
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

describe('the safety net: ErrorBoundary', () => {
  class Bomb extends Component<{ armed: boolean; children?: ReactNode }> {
    render() { if (this.props.armed) throw new Error('Тестовый взрыв'); return <div>цел и невредим</div> }
  }
  it('instead of a white screen it shows a message and buttons; the data does not suffer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><Bomb armed /></ErrorBoundary>)
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument()
    expect(screen.getByText(/Твои данные на месте/)).toBeInTheDocument()
    expect(screen.getByText('Тестовый взрыв')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Перезагрузить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить копию данных' })).toBeInTheDocument()
  })
  it('without an error it does not interfere', () => {
    render(<ErrorBoundary><Bomb armed={false} /></ErrorBoundary>)
    expect(screen.getByText('цел и невредим')).toBeInTheDocument()
  })
  it('"Save a copy of the data" downloads a file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await seed({ demo: true })
    const { default: userEvent } = await import('@testing-library/user-event')
    render(<ErrorBoundary inline><Bomb armed /></ErrorBoundary>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Сохранить копию данных' }))
    await waitFor(() => expect(downloaded()).toHaveLength(1))
    expect(await screen.findByText(/Копия сохранена/)).toBeInTheDocument()
  })
})
