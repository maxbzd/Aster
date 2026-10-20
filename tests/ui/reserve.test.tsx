import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { seed, renderApp, watchConsole } from './harness'

const dialog = () => screen.findByRole('dialog')

describe('reserve: adding', () => {
  beforeEach(() => seed({ demo: true }))

  it('"+" → "To the reserve": the smart field fills in the card, "Save" puts it in the database', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/people')
    await screen.findByText('Алина Воронцова')
    await user.click(screen.getAllByRole('button', { name: 'Добавить' })[0])
    await user.click(await screen.findByRole('button', { name: /^В резерв/ }))
    const d = within(await dialog())
    await user.click(d.getByPlaceholderText(/Вставь что есть/))
    await user.paste('Руслан Исаев — юрист по недвижимости, Дубай, t.me/ruslan_isaev')
    await waitFor(() => expect(d.getByPlaceholderText('Имя')).toHaveValue('Руслан'))
    expect(d.getByPlaceholderText('Фамилия')).toHaveValue('Исаев')
    await user.click(d.getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => expect(await db.leads.filter(l => l.firstName === 'Руслан').count()).toBe(1))
    const saved = await db.leads.filter(l => l.firstName === 'Руслан').first()
    expect(saved).toMatchObject({ lastName: 'Исаев', city: 'Дубай' })
    expect(saved?.tags).toContain('Юрист')
    expect(saved?.channels).toEqual([{ type: 'telegram', value: 'ruslan_isaev' }])
    expect(bad).toEqual([])
  })

  it('"Another one" saves and clears the form, the source stays', async () => {
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByRole('button', { name: 'Добавить контакт' }))
    const d = within(await dialog())
    await user.type(d.getByPlaceholderText('Имя'), 'Первый')
    await user.type(d.getByPlaceholderText(/Web Summit, чат/), 'Форум')
    await user.click(d.getByRole('button', { name: 'Ещё один' }))
    await waitFor(async () => expect(await db.leads.filter(l => l.firstName === 'Первый').count()).toBe(1))
    expect(d.getByPlaceholderText('Имя')).toHaveValue('')
    expect(d.getByDisplayValue('Форум')).toBeInTheDocument()
  })

  it('you cannot save without a name', async () => {
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByRole('button', { name: 'Добавить контакт' }))
    const d = within(await dialog())
    expect(d.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(d.getByRole('button', { name: 'Ещё один' })).toBeDisabled()
  })

  it('warns about a repeat if the person is already in the reserve or the network', async () => {
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByRole('button', { name: 'Добавить контакт' }))
    const d = within(await dialog())
    await user.click(d.getByPlaceholderText(/Вставь что есть/))
    await user.paste('Давид Шварц')
    expect(await d.findByText(/уже есть в резерве/)).toBeInTheDocument()
  })

  it('Esc closes the sheet', async () => {
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByRole('button', { name: 'Добавить контакт' }))
    await dialog()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('reserve: importing a list', () => {
  beforeEach(() => seed({ demo: true }))
  const list = `1. Артём Волков — основатель fintech-стартапа, Дубай, @artem_volkov, +971 50 777 88 99
2. Яна Соколова, юрист по IP, Лондон, yana@iplaw.example
3. https://www.linkedin.com/in/oleg-markov-2b7c1d
4. Давид Шварц, партнёр фонда`

  it('paste text → review → add → undo with one tap', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/reserve')
    const before = await db.leads.count()
    await user.click(await screen.findByRole('button', { name: 'Загрузить список' }))
    const d = within(await dialog())
    await user.click(d.getByPlaceholderText(/По человеку на строку/))
    await user.paste(list)
    await user.click(d.getByRole('button', { name: 'Разобрать текст' }))
    expect(await d.findByText(/будет добавлен/)).toBeInTheDocument()
    // David Schwartz is already in the reserve: the repeat is skipped
    expect(d.getByText(/пропущу 1/)).toBeInTheDocument()
    await user.type(d.getByPlaceholderText(/Web Summit/), 'Конференция X')
    await user.click(d.getByRole('button', { name: 'Добавить 3 в резерв' }))
    await waitFor(async () => expect(await db.leads.count()).toBe(before + 3))
    const added = await db.leads.filter(l => l.source === 'Конференция X').toArray()
    expect(added).toHaveLength(3)
    expect(new Set(added.map(l => l.batchId)).size).toBe(1)
    await user.click(await screen.findByRole('button', { name: 'Отменить' }))
    await waitFor(async () => expect(await db.leads.count()).toBe(before))
    expect(bad).toEqual([])
  })

  it('with no repeats, "Skip repeats" can be switched off', async () => {
    const { user } = renderApp('/reserve')
    const before = await db.leads.count()
    await user.click(await screen.findByRole('button', { name: 'Загрузить список' }))
    const d = within(await dialog())
    await user.click(d.getByPlaceholderText(/По человеку на строку/))
    await user.paste('Давид Шварц, партнёр фонда\nНовый Человек')
    await user.click(d.getByRole('button', { name: 'Разобрать текст' }))
    await d.findByText(/будет добавлен/)
    await user.click(d.getByText('Пропускать повторы'))
    await user.click(d.getByRole('button', { name: /Добавить 2/ }))
    await waitFor(async () => expect(await db.leads.count()).toBe(before + 2))
  })

  it('a table from Excel (pasted with tabs): the column mapping step', async () => {
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByRole('button', { name: 'Загрузить список' }))
    const d = within(await dialog())
    await user.click(d.getByPlaceholderText(/По человеку на строку/))
    await user.paste('Имя\tФамилия\tТелефон\tТеги\nАнна\tКимова\t79001234567\tюрист\nБорис\tЛимов\t79007654321\tдизайн')
    await user.click(d.getByRole('button', { name: 'Разобрать текст' }))
    expect(await d.findByText('Что в колонках?')).toBeInTheDocument()
    expect(d.getByRole('button', { name: /Далее · 2 контакта/ })).toBeEnabled()
    await user.click(d.getByRole('button', { name: /Далее/ }))
    await user.click(await d.findByRole('button', { name: /Добавить 2/ }))
    await waitFor(async () => expect(await db.leads.filter(l => l.lastName === 'Кимова').count()).toBe(1))
    const anna = await db.leads.filter(l => l.lastName === 'Кимова').first()
    expect(anna?.channels).toEqual([{ type: 'phone', value: '+7 900 123-45-67' }])
    expect(anna?.tags).toEqual(['Юрист'])
  })

  it('empty input: the button is unavailable; nothing recognised: a clear error', async () => {
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByRole('button', { name: 'Загрузить список' }))
    const d = within(await dialog())
    expect(d.getByRole('button', { name: 'Разобрать текст' })).toBeDisabled()
  })
})

describe('reserve: the contact card', () => {
  beforeEach(() => seed({ demo: true }))

  it('"What to write": three tones, formal address, a way back', async () => {
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByText('Давид Шварц'))
    const d = within(await dialog())
    await user.click(await d.findByRole('button', { name: /Что написать/ }))
    const box = await d.findByRole('textbox')
    expect((box as HTMLTextAreaElement).value).toMatch(/^Давид, здравствуйте!/)
    const warm = (box as HTMLTextAreaElement).value
    await user.click(d.getByRole('button', { name: 'Коротко' }))
    await waitFor(() => expect((d.getByRole('textbox') as HTMLTextAreaElement).value).not.toBe(warm))
    await user.click(d.getByRole('button', { name: 'Назад' }))
    expect(await d.findByText('Чем ценен')).toBeInTheDocument()
  })

  it('"To the network" moves to people and opens the profile', async () => {
    const { user } = renderApp('/reserve')
    const before = await db.people.count()
    await user.click(await screen.findByText('Арман Касымов'))
    const d = within(await dialog())
    await user.click(await d.findByRole('button', { name: 'В сеть' }))
    await user.click(await d.findByRole('button', { name: /Перенести в сеть/ }))
    await waitFor(async () => expect(await db.people.count()).toBe(before + 1))
    expect(await db.leads.filter(l => l.firstName === 'Арман').count()).toBe(0)
    expect((await screen.findAllByText('Арман Касымов')).length).toBeGreaterThan(0)
    expect(window.location.hash).toMatch(/^#\/person\//)
  })

  it('"Strong" toggles the star and saves it', async () => {
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByText('Арман Касымов'))
    const d = within(await dialog())
    await user.click(await d.findByRole('button', { name: 'Сильный' }))
    await waitFor(async () => expect((await db.leads.filter(l => l.firstName === 'Арман').first())?.star).toBe(true))
    await user.click(d.getByRole('button', { name: 'Сильный' }))
    await waitFor(async () => expect((await db.leads.filter(l => l.firstName === 'Арман').first())?.star).toBe(false))
  })

  it('deletion in two steps with confirmation', async () => {
    const { user } = renderApp('/reserve')
    const before = await db.leads.count()
    await user.click(await screen.findByText('Арман Касымов'))
    const d = within(await dialog())
    await user.click(await d.findByRole('button', { name: /Удалить из резерва/ }))
    expect(await db.leads.count()).toBe(before)
    await user.click(await d.findByRole('button', { name: /Точно удалить/ }))
    await waitFor(async () => expect(await db.leads.count()).toBe(before - 1))
  })

  it('a contact with no channels: "Write" suggests adding a contact instead of crashing', async () => {
    await db.leads.put({ id: 'bare', firstName: 'Безконтактный', tags: [], channels: [], createdAt: Date.now(), updatedAt: Date.now() })
    const { user } = renderApp('/reserve')
    await user.click(await screen.findByText('Безконтактный'))
    const d = within(await dialog())
    await user.click(await d.findByRole('button', { name: 'Написать' }))
    expect(await screen.findByText(/Добавь контакт в карточке/)).toBeInTheDocument()
  })
})

describe('reserve: the list', () => {
  beforeEach(() => seed({ demo: true }))

  it('filter by tag, "Strong", sorting, search', async () => {
    const { user } = renderApp('/reserve')
    await screen.findByText('Давид Шварц')
    await user.click(screen.getByRole('button', { name: /^Юрист · \d+/ }))
    expect(screen.getByText('Арман Касымов')).toBeInTheDocument()
    expect(screen.queryByText('Давид Шварц')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Все · \d+/ }))
    await user.click(screen.getByRole('button', { name: /^Сильные · \d+/ }))
    expect(screen.getByText('Давид Шварц')).toBeInTheDocument()
    expect(screen.queryByText('Арман Касымов')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Все · \d+/ }))
    await user.type(screen.getByPlaceholderText(/Кто, чем занимается/), 'виза')
    await waitFor(() => expect(screen.getByText('Арман Касымов')).toBeInTheDocument())
    expect(screen.queryByText('Давид Шварц')).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/Кто, чем занимается/), 'ёёёё')
    expect(await screen.findByText(/Никого не нашлось/)).toBeInTheDocument()
  })

  it('the "Useful right now" block links a request from the network with a contact from the reserve', async () => {
    renderApp('/reserve')
    expect(await screen.findByText('Пригодятся сейчас')).toBeInTheDocument()
    expect(await screen.findByText(/ищет «UX-дизайнер/)).toBeInTheDocument()
  })

  it('selection mode: a tag and deletion with undo', async () => {
    const { user } = renderApp('/reserve')
    await screen.findByText('Давид Шварц')
    const before = await db.leads.count()
    await user.click(screen.getByRole('button', { name: 'Выбрать' }))
    await user.click(screen.getByText('Давид Шварц'))
    await user.click(screen.getByText('Арман Касымов'))
    expect(screen.getByText('Выбрано 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Метка' }))
    const d = within(await dialog())
    await user.type(d.getByPlaceholderText(/Например: Дубай/), 'Важные{Enter}')
    await user.click(d.getByRole('button', { name: 'Добавить' }))
    await waitFor(async () => expect(await db.leads.where('tags').equals('Важные').count()).toBe(2))
    // after a tag is added, selection mode closes on its own
    await user.click(await screen.findByRole('button', { name: 'Выбрать' }))
    await user.click(screen.getByText('Давид Шварц'))
    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(async () => expect(await db.leads.count()).toBe(before - 1))
    await user.click(await screen.findByRole('button', { name: 'Вернуть' }))
    await waitFor(async () => expect(await db.leads.count()).toBe(before))
  })
})

describe('⌘K search finds the reserve', () => {
  beforeEach(() => seed({ demo: true }))
  it('both by name and "by meaning"', async () => {
    const { user } = renderApp('/')
    await screen.findByText(/тонус сети/i)
    await user.keyboard('{Control>}k{/Control}')
    const input = await screen.findByPlaceholderText(/Найди человека или спроси сеть/)
    await user.type(input, 'Шварц')
    expect((await screen.findAllByText('Давид Шварц')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Резерв').length).toBeGreaterThan(0)
    await user.clear(input)
    await user.type(input, 'Кто поможет с визой в ОАЭ?{Enter}')
    expect(await screen.findByText(/Из резерва/, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Арман Касымов')).toBeInTheDocument()
  })
})
