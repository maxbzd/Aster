import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '@/app/store'
import { db } from '@/data/db'
import { sealBackupWithPassword, createAutoBackupKey, sealBackupToKey } from '@/data/backupSeal'
import { exportBackup } from '@/data/actions'
import { renderApp, seed } from './harness'

const argon2 = { m: 64, t: 1, p: 1 }
const downloads = vi.hoisted(() => ({ files: [] as Array<{ name: string; text: string }> }))
vi.mock('@/lib/ics', async original => ({ ...(await original<typeof import('@/lib/ics')>()), download: (name: string, text: string) => { downloads.files.push({ name, text: String(text) }) } }))

beforeEach(async () => { downloads.files = []; await seed({ demo: true }) })
afterEach(() => { act(() => useUI.getState().close()) })

const passwordInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type=password]')]

describe('the backup sheet', () => {
  it('saves an encrypted file by default, and nothing readable is in it', async () => {
    const { user } = renderApp('/me')
    await screen.findByText('Резервная копия')
    act(() => useUI.getState().open({ kind: 'backup' }))
    expect(await screen.findByText('Зашифрованный файл')).toBeInTheDocument()

    // weak or mismatched passwords are refused, and nothing is written
    await user.click(screen.getByRole('button', { name: 'Сохранить файл копии' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Используй не меньше 8 символов.')
    const [a, b] = passwordInputs()
    await user.type(a!, 'длинный-пароль')
    await user.type(b!, 'другой-пароль!')
    await user.click(screen.getByRole('button', { name: 'Сохранить файл копии' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Два ввода не совпадают.')
    expect(downloads.files).toHaveLength(0)

    await user.clear(b!)
    await user.type(b!, 'длинный-пароль')
    await user.click(screen.getByRole('button', { name: 'Сохранить файл копии' }))
    await waitFor(() => expect(downloads.files).toHaveLength(1), { timeout: 15_000 })
    const file = downloads.files[0]!
    expect(file.name).toMatch(/^aster-backup-\d{4}-\d{2}-\d{2}\.aster\.json$/)
    const people = await db.people.toArray()
    expect(people.length).toBeGreaterThan(10)
    for (const p of people.slice(0, 5)) expect(file.text).not.toContain(p.firstName)
    expect(JSON.parse(file.text)).toMatchObject({ app: 'aster', encrypted: 'password' })
    expect((await db.settings.get('me'))?.lastBackupAt).toBeGreaterThan(0)
  }, 30_000)

  it('can still save a plain file, when asked', async () => {
    const { user } = renderApp('/me')
    await screen.findByText('Резервная копия')
    act(() => useUI.getState().open({ kind: 'backup' }))
    await user.click(await screen.findByText('Обычный файл'))
    await user.click(screen.getByRole('button', { name: 'Сохранить файл копии' }))
    await waitFor(() => expect(downloads.files).toHaveLength(1))
    expect(JSON.parse(downloads.files[0]!.text)).toMatchObject({ app: 'aster', people: expect.any(Array) })
  })
})

describe('restoring an encrypted backup', () => {
  const open = (file: unknown, mode: 'replace' | 'merge' = 'replace') => act(() => useUI.getState().open({ kind: 'restore', mode, file }))

  it('asks for the password, refuses a wrong one, and restores with the right one', async () => {
    const plain = await exportBackup()
    const file = await sealBackupWithPassword(plain, 'верный-пароль', argon2)
    const total = await db.people.count()
    await db.people.clear()
    const { user } = renderApp('/me')
    await screen.findByText('Резервная копия')
    open(file)
    expect(await screen.findByText('Эта копия зашифрована')).toBeInTheDocument()
    const input = passwordInputs()[0]!
    await user.type(input, 'не-тот-пароль')
    await user.click(screen.getByRole('button', { name: 'Восстановить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный пароль, или файл повреждён.')
    expect(await db.people.count()).toBe(0)

    await user.clear(input)
    await user.type(input, 'верный-пароль')
    await user.click(screen.getByRole('button', { name: 'Восстановить' }))
    await waitFor(async () => expect(await db.people.count()).toBe(total))
  })

  it('an automatic copy asks for the passphrase', async () => {
    const config = await createAutoBackupKey('моя фраза', argon2)
    const file = await sealBackupToKey(await exportBackup(), config)
    await db.people.clear()
    const { user } = renderApp('/me')
    await screen.findByText('Резервная копия')
    open(file)
    expect(await screen.findByText('Введи фразу, которую ты задал для автоматических копий.')).toBeInTheDocument()
    await user.type(passwordInputs()[0]!, 'моя фраза')
    await user.click(screen.getByRole('button', { name: 'Восстановить' }))
    await waitFor(async () => expect(await db.people.count()).toBeGreaterThan(10))
  })
})

describe('the list of replaced edits', () => {
  it('shows what lost, brings a value back, and can be cleared', async () => {
    const p = (await db.people.toArray())[0]!
    await db.syncMeta.put({ key: 'conflicts', value: [{ table: 'people', id: p.id, path: 'city', lost: 'Лиссабон', kept: 'remote', at: Date.now() }, { table: 'people', id: p.id, path: 'topics[id:t1].text', lost: 'старый текст', kept: 'remote', at: Date.now() }] })
    const { user } = renderApp('/me')
    await screen.findByText('Резервная копия')
    act(() => useUI.getState().open({ kind: 'syncHistory' }))
    expect(await screen.findByText('Замещённые правки')).toBeInTheDocument()
    expect((await screen.findAllByText(new RegExp(p.firstName))).length).toBe(2)
    expect(screen.getByText('Лиссабон')).toBeInTheDocument()
    // the entry inside a list item cannot be restored automatically: it offers a copy instead
    expect(screen.getAllByRole('button', { name: 'Восстановить' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Восстановить' }))
    await waitFor(async () => expect((await db.people.get(p.id))?.city).toBe('Лиссабон'))
    await user.click(await screen.findByRole('button', { name: 'Очистить список' }))
    expect(await screen.findByText(/Ничего не заменялось/)).toBeInTheDocument()
  })
})

describe('encrypting the cloud copy', () => {
  it('turn it on, write the key down, then add a second device through the code exchange', async () => {
    const { useCloud } = await import('@/cloud/store')
    const { beginJoin, completeJoin } = await import('@/cloud/e2eSetup')
    act(() => useCloud.setState({ phase: 'idle', userId: 'u1', email: 'a@b.c', e2e: 'off' }))
    const { user } = renderApp('/me')
    await screen.findByText('Резервная копия')
    act(() => useUI.getState().open({ kind: 'cloudKey' }))
    await user.click(await screen.findByRole('button', { name: 'Включить' }))
    const key = (await screen.findByTestId('recovery-key')).textContent!
    expect(key).toMatch(/^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Готово' }))
    const mine = (await db.settings.get('me'))?.e2e
    expect(mine?.key).toBeTruthy()
    expect(JSON.stringify(await exportBackup())).not.toContain(mine!.key) // the key is not in a backup

    // the sheet switches to the "on" state once a sync reports it
    act(() => useCloud.setState({ e2e: 'on' }))
    await user.click(await screen.findByRole('button', { name: 'Добавить устройство' }))
    const newDevice = await beginJoin()
    const field = (await screen.findAllByRole('textbox'))[0]!
    await user.click(field)
    await user.paste(newDevice.code) // typing 1,700 characters one by one would take longer than the test
    await user.click(screen.getByRole('button', { name: 'Дальше' }))
    expect((await screen.findByTestId('digits')).textContent).toBe(newDevice.checkDigits)
    await user.click(screen.getByRole('button', { name: 'Совпадают: создать ответ' }))
    const answer = (await screen.findByTestId('code')).textContent!
    expect(answer.startsWith('SEAL1.')).toBe(true)

    // the new device opens the answer and ends up with the same key
    const before = mine!.key
    await db.settings.update('me', { e2e: undefined })
    await completeJoin(newDevice, answer)
    expect((await db.settings.get('me'))?.e2e?.key).toBe(before)
  })
})
