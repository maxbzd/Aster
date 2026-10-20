import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCloud, useCloud } from '@/cloud/store'
import { renderApp, seed, watchConsole } from './harness'

const cloud = vi.hoisted(() => {
  class UnsyncedError extends Error {
    constructor(public pending: number) { super(`pending ${pending}`) }
  }
  return {
    UnsyncedError,
    signIn: vi.fn(async () => undefined),
    signUp: vi.fn(async (): Promise<'signed-in' | 'confirm'> => 'confirm'),
    resetPassword: vi.fn(async () => undefined),
    setNewPassword: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => undefined),
    resync: vi.fn(async () => undefined),
    bootCloud: vi.fn(async () => undefined),
  }
})
vi.mock('@/cloud/cloud', () => cloud)

const dialog = () => screen.findByRole('dialog')
const reset = () => {
  useCloud.setState({ phase: 'off', email: undefined, userId: undefined, lastSyncAt: undefined, pending: 0, error: undefined, recovery: false, expired: false, notice: undefined })
  for (const f of Object.values(cloud)) if (typeof f === 'function' && 'mockClear' in f) (f as ReturnType<typeof vi.fn>).mockClear()
}

describe('Облако: вход', () => {
  beforeEach(async () => { reset(); await seed({ demo: true }) })

  it('карточка в профиле открывает шторку входа', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/me')
    expect(await screen.findByText('Войти, чтобы данные были на всех устройствах')).toBeInTheDocument()
    await user.click(screen.getByText('Облако'))
    const d = within(await dialog())
    expect(d.getAllByRole('button', { name: 'Войти' })).toHaveLength(2) // вкладка и кнопка отправки
    expect(d.getByText(/Ключи Астры остаются только на этом устройстве/)).toBeInTheDocument()
    expect(bad).toEqual([])
  })

  it('проверяет почту и пароль до обращения к серверу', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getAllByRole('button', { name: 'Войти' }).at(-1)!)
    expect(await d.findByRole('alert')).toHaveTextContent('Проверь адрес почты')
    await user.type(d.getByLabelText('Почта'), 'max@mail.com')
    await user.click(d.getAllByRole('button', { name: 'Войти' }).at(-1)!)
    expect(await d.findByRole('alert')).toHaveTextContent('Введи пароль')
    expect(cloud.signIn).not.toHaveBeenCalled()
  })

  it('вход: почта без пробелов, пароль как есть; ошибка сервера показывается человеческим языком', async () => {
    cloud.signIn.mockRejectedValueOnce(new Error('Неверная почта или пароль'))
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.type(d.getByLabelText('Почта'), 'max@mail.com')
    await user.type(d.getByLabelText('Пароль'), 'hunter2hunter2')
    await user.click(d.getAllByRole('button', { name: 'Войти' }).at(-1)!)
    expect(await d.findByRole('alert')).toHaveTextContent('Неверная почта или пароль')
    expect(cloud.signIn).toHaveBeenCalledWith('max@mail.com', 'hunter2hunter2')
    expect(d.getByLabelText('Пароль')).toHaveAttribute('type', 'password')
  })

  it('регистрация: короткий пароль отклоняется, затем «проверь почту»', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getByRole('button', { name: 'Создать аккаунт' }))
    await user.type(d.getByLabelText('Почта'), 'new@mail.com')
    await user.type(d.getByLabelText('Пароль'), 'short')
    await user.click(d.getAllByRole('button', { name: 'Создать аккаунт' }).at(-1)!)
    expect(await d.findByRole('alert')).toHaveTextContent('не короче 8 символов')
    expect(cloud.signUp).not.toHaveBeenCalled()

    await user.clear(d.getByLabelText('Пароль'))
    await user.type(d.getByLabelText('Пароль'), 'long-enough-pass')
    await user.click(d.getAllByRole('button', { name: 'Создать аккаунт' }).at(-1)!)
    expect(await d.findByText('Проверь почту')).toBeInTheDocument()
    expect(d.getByText(/«new@mail.com»/)).toBeInTheDocument()
    expect(cloud.signUp).toHaveBeenCalledWith('new@mail.com', 'long-enough-pass')
  })

  it('«Забыл пароль» отправляет ссылку, пароль не спрашивает', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getByRole('button', { name: 'Забыл пароль' }))
    expect(d.queryByLabelText('Пароль')).not.toBeInTheDocument()
    await user.type(d.getByLabelText('Почта'), 'max@mail.com')
    await user.click(d.getByRole('button', { name: 'Прислать ссылку' }))
    expect(await d.findByText('Проверь почту')).toBeInTheDocument()
    expect(cloud.resetPassword).toHaveBeenCalledWith('max@mail.com')
  })

  it('сессия истекла — понятное сообщение, данные целы', async () => {
    useCloud.setState({ expired: true })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    expect(await within(await dialog()).findByText(/Сессия закончилась/)).toBeInTheDocument()
  })

  it('на первом экране приложения есть вход для нового устройства', async () => {
    await seed({ onboarded: false })
    const { user } = renderApp('/')
    await user.click(await screen.findByText('Войти'))
    expect(await within(await dialog()).findByLabelText('Почта')).toBeInTheDocument()
  })
})

describe('Облако: аккаунт', () => {
  beforeEach(async () => {
    reset()
    await seed({ demo: true })
    useCloud.setState({ phase: 'idle', email: 'max@mail.com', userId: 'u1', lastSyncAt: Date.now() - 120_000, pending: 0 })
  })

  it('карточка показывает почту и статус; демо-данные скрыты, чтобы не затереть облако', async () => {
    renderApp('/me')
    expect(await screen.findByText(/max@mail.com · Всё синхронизировано/)).toBeInTheDocument()
    expect(screen.queryByText('Загрузить демо-данные')).not.toBeInTheDocument()
    expect(screen.getByText('Данные у тебя и в облаке')).toBeInTheDocument()
  })

  it('статус живой: офлайн с ожидающими изменениями, потом ошибка', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    expect(d.getByRole('status')).toHaveTextContent('Всё синхронизировано')
    act(() => setCloud({ phase: 'offline', pending: 3 }))
    expect(d.getByRole('status')).toHaveTextContent('Нет сети · 3 изменения ждут отправки')
    act(() => setCloud({ phase: 'error', error: 'Слишком много попыток — подожди минуту и повтори' }))
    expect(d.getByRole('status')).toHaveTextContent('Слишком много попыток')
  })

  it('«Синхронизировать сейчас» и «Полная пересинхронизация»', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getByText('Синхронизировать сейчас'))
    await waitFor(() => expect(cloud.syncNow).toHaveBeenCalledTimes(1))
    await user.click(d.getByText('Полная пересинхронизация'))
    await waitFor(() => expect(cloud.resync).toHaveBeenCalledTimes(1))
  })

  it('выход: подтверждение, затем вызов signOut', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getByText('Выйти на этом устройстве'))
    expect(d.getByText(/Всё, что на устройстве, уже есть в облаке/)).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Выйти' }))
    await waitFor(() => expect(cloud.signOut).toHaveBeenCalledWith({ force: false }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('выход с неотправленными изменениями предупреждает и требует подтверждения', async () => {
    cloud.signOut.mockRejectedValueOnce(new cloud.UnsyncedError(4))
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getByText('Выйти на этом устройстве'))
    await user.click(d.getByRole('button', { name: 'Выйти' }))
    expect(await d.findByText(/Не отправлено 4 изменения/)).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Выйти всё равно' }))
    await waitFor(() => expect(cloud.signOut).toHaveBeenLastCalledWith({ force: true }))
  })

  it('удаление аккаунта требует второго нажатия', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getByText('Удалить аккаунт и облачные данные'))
    expect(cloud.deleteAccount).not.toHaveBeenCalled()
    expect(d.getByText('Удалить аккаунт навсегда?')).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Отмена' }))
    expect(d.queryByText('Удалить аккаунт навсегда?')).not.toBeInTheDocument()
    await user.click(d.getByText('Удалить аккаунт и облачные данные'))
    await user.click(d.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(cloud.deleteAccount).toHaveBeenCalledTimes(1))
  })

  it('ссылка «сбросить пароль»: сразу открывается форма нового пароля', async () => {
    act(() => setCloud({ recovery: true }))
    const { user } = renderApp('/')
    const d = within(await dialog())
    const field = await d.findByLabelText('Новый пароль')
    expect(d.getByRole('button', { name: 'Сохранить пароль' })).toBeDisabled()
    await user.type(field, 'brand-new-pass')
    await user.click(d.getByRole('button', { name: 'Сохранить пароль' }))
    await waitFor(() => expect(cloud.setNewPassword).toHaveBeenCalledWith('brand-new-pass'))
  })

  it('сообщение о смене аккаунта показывается один раз в шторке', async () => {
    useCloud.setState({ notice: 'На устройстве были данные другого аккаунта — они удалены, загружаю твои.' })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    expect(await within(await dialog()).findByText(/данные другого аккаунта/)).toBeInTheDocument()
  })
})
