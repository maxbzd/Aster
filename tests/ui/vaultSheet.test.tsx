import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleRoot } from '@/i18n/react'
import { t } from '@/i18n'
import { useUI } from '@/app/store'
import { useVaultState } from '@/vault/state'

const KEY = 'ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0'
const prepared = vi.hoisted(() => ({ recoveryKey: 'ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0', commit: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }))
const runtime = vi.hoisted(() => ({
  prepare: vi.fn(async (_password: string) => prepared),
  verifyPassword: vi.fn(async (password: string) => password === 'текущий-пароль'),
  changePassword: vi.fn(async (_password: string) => undefined),
  renewRecoveryKey: vi.fn(async () => 'NEW00-00000-00000-00000-00000-00000-00000-00000-00000-00000-00000'),
  disable: vi.fn(async () => undefined),
  lock: vi.fn(async () => undefined),
  addPasskey: vi.fn(async () => undefined),
  removePasskey: vi.fn(async (_id: string) => undefined),
  autoLockMinutes: vi.fn(() => 5),
  setAutoLockMinutes: vi.fn(),
  header: vi.fn(() => ({ v: 1, app: 'aster', createdAt: 1, wraps: [{ kind: 'passkey', credentialId: 'cred-1', label: 'Телефон', iv: '', data: '', createdAt: Date.UTC(2026, 10, 1) }] })),
}))
vi.mock('@/vault', () => ({ vault: runtime }))
vi.mock('@/vault/passkey', () => ({
  passkeySupported: () => true,
  PasskeyError: class PasskeyError extends Error {},
  registerPasskey: vi.fn(async () => ({ credentialId: 'cred-2', prfSalt: new Uint8Array(32), secret: new Uint8Array(32) })),
}))
vi.mock('@/lib/ics', () => ({ download: vi.fn() }))

import { VaultSheet } from '@/sheets/VaultSheet'

const draw = (state: 'off' | 'unlocked') => {
  useVaultState.setState({ state, busy: false })
  const onClose = vi.fn()
  render(<LocaleRoot><VaultSheet onClose={onClose} /></LocaleRoot>)
  return { user: userEvent.setup(), onClose }
}
const dialog = () => within(screen.getByRole('dialog'))
const passwords = () => [...document.querySelectorAll<HTMLInputElement>('input[type=password]')]

beforeEach(() => { vi.clearAllMocks(); useUI.setState({ toasts: [] }) })

describe('turning protection on', () => {
  it('checks the password, then shows the recovery key once, and only turns on after it is confirmed saved', async () => {
    const { user } = draw('off')
    await user.click(await dialog().findByRole('button', { name: t('Set it up') }))
    const [a, b] = passwords()
    await user.type(a!, 'коротко')
    await user.click(dialog().getByRole('button', { name: t('Continue') }))
    expect(await dialog().findByRole('alert')).toHaveTextContent(t('Use at least {n} characters.', { n: 8 }))
    await user.clear(a!); await user.type(a!, 'длинный-пароль-1'); await user.type(b!, 'другой-пароль-22')
    await user.click(dialog().getByRole('button', { name: t('Continue') }))
    expect(await dialog().findByRole('alert')).toHaveTextContent(t('The two entries do not match.'))
    expect(runtime.prepare).not.toHaveBeenCalled()

    await user.clear(b!); await user.type(b!, 'длинный-пароль-1')
    await user.click(dialog().getByRole('button', { name: t('Continue') }))
    expect(await dialog().findByTestId('recovery-key')).toHaveTextContent(KEY)
    expect(runtime.prepare).toHaveBeenCalledWith('длинный-пароль-1')
    const turnOn = dialog().getByRole('button', { name: t('Turn protection on') })
    expect(turnOn).toBeDisabled()
    await user.click(dialog().getByRole('checkbox'))
    await user.click(turnOn)
    await waitFor(() => expect(prepared.commit).toHaveBeenCalledTimes(1))
  })

  it('cancelling after the key was shown aborts the preparation and changes nothing', async () => {
    const { user } = draw('off')
    await user.click(await dialog().findByRole('button', { name: t('Set it up') }))
    const [a, b] = passwords()
    await user.type(a!, 'длинный-пароль-1'); await user.type(b!, 'длинный-пароль-1')
    await user.click(dialog().getByRole('button', { name: t('Continue') }))
    await dialog().findByTestId('recovery-key')
    await user.click(dialog().getByRole('button', { name: t('Cancel') }))
    expect(prepared.abort).toHaveBeenCalledTimes(1)
    expect(prepared.commit).not.toHaveBeenCalled()
    expect(await dialog().findByRole('button', { name: t('Set it up') })).toBeInTheDocument()
  })

  it('says the device was not changed when the preparation fails', async () => {
    runtime.prepare.mockRejectedValueOnce(new Error(''))
    const { user } = draw('off')
    await user.click(await dialog().findByRole('button', { name: t('Set it up') }))
    const [a, b] = passwords()
    await user.type(a!, 'длинный-пароль-1'); await user.type(b!, 'длинный-пароль-1')
    await user.click(dialog().getByRole('button', { name: t('Continue') }))
    expect(await dialog().findByRole('alert')).toHaveTextContent(t("Couldn't turn protection on. Nothing was changed."))
  })
})

describe('managing protection that is on', () => {
  it('locks at once, and chooses how long to wait before it locks itself', async () => {
    const { user } = draw('unlocked')
    await user.click(await dialog().findByRole('button', { name: t('Lock now') }))
    expect(runtime.lock).toHaveBeenCalledTimes(1)
    await user.click(dialog().getByRole('button', { name: t('{n} min', { n: 15 }) }))
    expect(runtime.setAutoLockMinutes).toHaveBeenCalledWith(15)
  })

  it('changing the password needs the current one, and a wrong one changes nothing', async () => {
    const { user } = draw('unlocked')
    await user.click(await dialog().findByRole('button', { name: t('Change the password') }))
    const [current, next, repeat] = passwords()
    await user.type(current!, 'не-тот-пароль'); await user.type(next!, 'новый-пароль-77'); await user.type(repeat!, 'новый-пароль-77')
    await user.click(dialog().getAllByRole('button', { name: t('Change the password') }).at(-1)!)
    expect(await dialog().findByRole('alert')).toHaveTextContent(t('Wrong password.'))
    expect(runtime.changePassword).not.toHaveBeenCalled()

    await user.clear(current!); await user.type(current!, 'текущий-пароль')
    await user.click(dialog().getAllByRole('button', { name: t('Change the password') }).at(-1)!)
    await waitFor(() => expect(runtime.changePassword).toHaveBeenCalledWith('новый-пароль-77'))
    expect(useUI.getState().toasts.at(-1)?.text).toBe(t('Password changed'))
  })

  it('a new recovery key is shown after the password is confirmed, and the old one is said to stop working', async () => {
    const { user } = draw('unlocked')
    await user.click(await dialog().findByRole('button', { name: t('Make a new recovery key') }))
    expect(dialog().getByText(t('The old recovery key stops working.'))).toBeInTheDocument()
    await user.type(passwords()[0]!, 'текущий-пароль')
    await user.click(dialog().getAllByRole('button', { name: t('Make a new recovery key') }).at(-1)!)
    expect(await dialog().findByTestId('recovery-key')).toHaveTextContent('NEW00')
    expect(runtime.renewRecoveryKey).toHaveBeenCalledTimes(1)
  })

  it('turning protection off needs the password too', async () => {
    const { user } = draw('unlocked')
    await user.click(await dialog().findByRole('button', { name: t('Turn protection off') }))
    await user.type(passwords()[0]!, 'неверно')
    await user.click(dialog().getAllByRole('button', { name: t('Turn protection off') }).at(-1)!)
    expect(await dialog().findByRole('alert')).toHaveTextContent(t('Wrong password.'))
    expect(runtime.disable).not.toHaveBeenCalled()
    await user.clear(passwords()[0]!); await user.type(passwords()[0]!, 'текущий-пароль')
    await user.click(dialog().getAllByRole('button', { name: t('Turn protection off') }).at(-1)!)
    await waitFor(() => expect(runtime.disable).toHaveBeenCalledTimes(1))
  })

  it('lists passkeys, adds one and removes one', async () => {
    const { user } = draw('unlocked')
    expect(await dialog().findByText(/Телефон/)).toBeInTheDocument()
    await user.click(dialog().getByRole('button', { name: t('Add a passkey') }))
    await waitFor(() => expect(runtime.addPasskey).toHaveBeenCalledWith('cred-2', expect.any(Uint8Array), expect.any(Uint8Array), expect.any(String)))
    await user.click(dialog().getByRole('button', { name: t('Remove') }))
    await waitFor(() => expect(runtime.removePasskey).toHaveBeenCalledWith('cred-1'))
  })
})
