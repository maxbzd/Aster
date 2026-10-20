import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { seed, renderApp, watchConsole } from './harness'

describe('onboarding', () => {
  beforeEach(() => seed({ onboarded: false }))

  it('welcome → name → circles → "Start from scratch" leads to an empty home screen', async () => {
    const { user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: 'Начать' }))
    const input = await screen.findByRole('textbox')
    const next = await screen.findByRole('button', { name: 'Дальше' })
    expect(next).toBeDisabled() // you cannot go on without a name
    await user.type(input, 'Макс')
    expect(next).toBeEnabled()
    await user.click(next)
    await user.click(await screen.findByRole('button', { name: 'Дальше' }))
    await user.click(await screen.findByRole('button', { name: /С чистого листа/ }))
    expect(await screen.findByText('Твоя вселенная пока пуста')).toBeInTheDocument()
    expect((await db.settings.get('me'))?.name).toBe('Макс')
    expect((await db.settings.get('me'))?.onboarded).toBe(true)
    expect((await db.circles.count())).toBeGreaterThan(0)
  })

  it('"See an example" loads the demo data', async () => {
    const { user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: 'Начать' }))
    await user.type(await screen.findByRole('textbox'), 'Макс')
    await user.click(await screen.findByRole('button', { name: 'Дальше' }))
    await user.click(await screen.findByRole('button', { name: 'Дальше' }))
    await user.click(await screen.findByRole('button', { name: /Посмотреть на примере/ }))
    await waitFor(async () => { expect(await db.people.count()).toBe(32); expect(await db.leads.count()).toBe(23) }, { timeout: 8000 })
  })
})

describe('the home screen and navigation', () => {
  beforeEach(() => seed({ demo: true }))

  it('shows the greeting, the pulse and those due for a message', async () => {
    renderApp('/')
    expect(await screen.findByText(/Добр(ый|ое|ой)/)).toBeInTheDocument()
    expect(await screen.findByText(/тонус сети/i)).toBeInTheDocument()
    expect(await screen.findByText('ждут контакта')).toBeInTheDocument()
    expect(await screen.findByText('Поводы написать')).toBeInTheDocument()
  })

  it('the bottom menu: People → Orbit → Profile → Today', async () => {
    const { user } = renderApp('/')
    const nav = await screen.findAllByRole('navigation')
    const tabs = within(nav[0])
    await user.click(await tabs.findByRole('link', { name: /Люди/ }))
    expect(await screen.findByRole('heading', { name: 'Люди' })).toBeInTheDocument()
    await user.click(await tabs.findByRole('link', { name: /Орбита/ }))
    expect(await screen.findByRole('heading', { name: /Орбита/ })).toBeInTheDocument()
    await user.click(await tabs.findByRole('link', { name: /^Я$|Я/ }))
    expect(await screen.findByRole('heading', { name: 'Профиль' })).toBeInTheDocument()
    await user.click(await tabs.findByRole('link', { name: /Сегодня/ }))
    expect(await screen.findByText(/тонус сети/i)).toBeInTheDocument()
  })

  it('"People": search, the Network / Reserve switch, a person\'s profile', async () => {
    const { user } = renderApp('/people')
    expect(await screen.findByText('Алина Воронцова')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/Имя, компания/), 'Воронцова')
    await waitFor(() => expect(screen.queryByText('Анна Ривера')).not.toBeInTheDocument())
    await user.click(screen.getByText('Алина Воронцова'))
    expect(await screen.findByText(/вы знакомы уже/i)).toBeInTheDocument()
    expect(screen.getByText('Основательница', { exact: false })).toBeInTheDocument()
  })

  it('the "Reserve" switch opens the reserve with a counter', async () => {
    const { user } = renderApp('/people')
    await user.click(await screen.findByRole('button', { name: /Резерв · \d+/ }))
    expect(await screen.findByRole('heading', { name: 'Резерв' })).toBeInTheDocument()
    expect(await screen.findByText('Давид Шварц')).toBeInTheDocument()
  })

  it('a non-existent person shows "Person not found", not an endless loading', async () => {
    renderApp('/person/нет-такого')
    expect(await screen.findByText('Человек не найден')).toBeInTheDocument()
  })

  it('an unknown address shows the home screen', async () => {
    renderApp('/нет/такой/страницы')
    expect(await screen.findByText(/тонус сети/i)).toBeInTheDocument()
  })
})

describe('empty states', () => {
  beforeEach(() => seed({}))
  it.each([
    ['/', 'Твоя вселенная пока пуста'],
    ['/reserve', 'Люди про запас'],
    ['/pulse', 'Пока нечего измерять'],
    ['/review', 'Пока некого разбирать'],
    ['/orbit', /Добавь людей/],
  ])('%s', async (route, text) => {
    renderApp(route)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})

describe('every screen opens without React errors and warnings', () => {
  beforeEach(() => seed({ demo: true }))
  const routes = ['/', '/people', '/reserve', '/orbit', '/me', '/pulse', '/review', '/capture?autostart=0', '/event', '/intros', '/weekly']
  it.each(routes)('%s', async route => {
    const bad = watchConsole()
    renderApp(route)
    await waitFor(() => expect(document.querySelector('main')?.textContent?.length ?? 0).toBeGreaterThan(20), { timeout: 8000 })
    await new Promise(r => setTimeout(r, 300))
    expect(bad).toEqual([])
  })
})
