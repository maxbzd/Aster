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

describe('Cloud: sign-in', () => {
  beforeEach(async () => { reset(); await seed({ demo: true }) })

  it('the card in the profile opens the sign-in sheet', async () => {
    const bad = watchConsole()
    const { user } = renderApp('/me')
    expect(await screen.findByText('Войти, чтобы данные были на всех устройствах')).toBeInTheDocument()
    await user.click(screen.getByText('Облако'))
    const d = within(await dialog())
    expect(d.getAllByRole('button', { name: 'Войти' })).toHaveLength(2) // the tab and the submit button
    expect(d.getByText(/Ключи Астры остаются только на этом устройстве/)).toBeInTheDocument()
    expect(bad).toEqual([])
  })

  it('checks the email and password before calling the server', async () => {
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

  it('sign-in: the email without spaces, the password as is; a server error is shown in human language', async () => {
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

  it('sign-up: a short password is rejected, then "check your email"', async () => {
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

  it('"Forgot password" sends a link, does not ask for a password', async () => {
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

  it('the session expired: a clear message, the data is intact', async () => {
    useCloud.setState({ expired: true })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    expect(await within(await dialog()).findByText(/Сессия закончилась/)).toBeInTheDocument()
  })

  it('the first screen of the app has a sign-in for a new device', async () => {
    await seed({ onboarded: false })
    const { user } = renderApp('/')
    await user.click(await screen.findByText('Войти'))
    expect(await within(await dialog()).findByLabelText('Почта')).toBeInTheDocument()
  })
})

describe('Cloud: account', () => {
  beforeEach(async () => {
    reset()
    await seed({ demo: true })
    useCloud.setState({ phase: 'idle', email: 'max@mail.com', userId: 'u1', lastSyncAt: Date.now() - 120_000, pending: 0 })
  })

  it('the card shows the email and status; demo data is hidden so as not to overwrite the cloud', async () => {
    renderApp('/me')
    expect(await screen.findByText(/max@mail.com · Всё синхронизировано/)).toBeInTheDocument()
    expect(screen.queryByText('Загрузить демо-данные')).not.toBeInTheDocument()
    expect(screen.getByText('Данные у тебя и в облаке')).toBeInTheDocument()
  })

  it('the live status: offline with pending changes, then an error', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    expect(d.getByRole('status')).toHaveTextContent('Всё синхронизировано')
    act(() => setCloud({ phase: 'offline', pending: 3 }))
    expect(d.getByRole('status')).toHaveTextContent('Нет сети · 3 изменения ждут отправки')
    act(() => setCloud({ phase: 'error', error: 'Слишком много попыток — подожди минуту и повтори' }))
    expect(d.getByRole('status')).toHaveTextContent('Слишком много попыток')
  })

  it('"Sync now" and "Full resync"', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getByText('Синхронизировать сейчас'))
    await waitFor(() => expect(cloud.syncNow).toHaveBeenCalledTimes(1))
    await user.click(d.getByText('Полная пересинхронизация'))
    await waitFor(() => expect(cloud.resync).toHaveBeenCalledTimes(1))
  })

  it('sign-out: a confirmation, then a signOut call', async () => {
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    const d = within(await dialog())
    await user.click(d.getByText('Выйти на этом устройстве'))
    expect(d.getByText(/Всё, что на устройстве, уже есть в облаке/)).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: 'Выйти' }))
    await waitFor(() => expect(cloud.signOut).toHaveBeenCalledWith({ force: false }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('signing out with unsent changes warns and requires confirmation', async () => {
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

  it('deleting the account requires a second press', async () => {
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

  it('a "reset password" link: the new-password form opens at once', async () => {
    act(() => setCloud({ recovery: true }))
    const { user } = renderApp('/')
    const d = within(await dialog())
    const field = await d.findByLabelText('Новый пароль')
    expect(d.getByRole('button', { name: 'Сохранить пароль' })).toBeDisabled()
    await user.type(field, 'brand-new-pass')
    await user.click(d.getByRole('button', { name: 'Сохранить пароль' }))
    await waitFor(() => expect(cloud.setNewPassword).toHaveBeenCalledWith('brand-new-pass'))
  })

  it('the account-switch message is shown once in the sheet', async () => {
    useCloud.setState({ notice: 'На устройстве были данные другого аккаунта — они удалены, загружаю твои.' })
    const { user } = renderApp('/me')
    await user.click(await screen.findByText('Облако'))
    expect(await within(await dialog()).findByText(/данные другого аккаунта/)).toBeInTheDocument()
  })
})
