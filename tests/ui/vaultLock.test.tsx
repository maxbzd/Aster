import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleRoot } from '@/i18n/react'
import { t } from '@/i18n'
import { useVaultState } from '@/vault/state'

type Result = 'ok' | 'wrong' | 'wait' | 'tab' | 'error'
const runtime = vi.hoisted(() => ({
  unlock: vi.fn<(c: unknown) => Promise<Result>>(),
  header: vi.fn(() => ({ v: 1, app: 'aster', createdAt: 1, wraps: [{ kind: 'passkey', credentialId: 'cred', iv: '', data: '', createdAt: 1 }] })),
  secondsUntilRetry: vi.fn(() => 7),
  eraseEverything: vi.fn(async () => undefined),
  boot: vi.fn(async () => { (await import('@/vault/state')).useVaultState.setState({ state: 'locked' }) }),
}))
vi.mock('@/vault', async () => ({ ...(await vi.importActual<object>('@/vault/state')), vault: runtime }))
const backend = vi.hoisted(() => ({ journalExists: vi.fn(async (_name: string): Promise<boolean | null> => true), selectNativeBackend: vi.fn() }))
vi.mock('@/vault/backend', () => backend)
vi.mock('@/vault/passkey', () => ({
  passkeySupported: () => true,
  PasskeyError: class PasskeyError extends Error { constructor(public code: string) { super(code) } },
  askVaultPasskey: vi.fn(async () => ({ credentialId: 'cred', secret: new Uint8Array(32) })),
}))

import VaultLock from '@/components/VaultLock'
import { VaultGate } from '@/components/VaultGate'

const draw = () => render(<LocaleRoot><VaultLock /></LocaleRoot>)
beforeEach(() => { vi.clearAllMocks(); useVaultState.setState({ state: 'locked', busy: false }) })

describe('the lock screen', () => {
  it('offers the password first, and does nothing until something is typed', async () => {
    draw()
    expect(await screen.findByText(t('Aster is locked'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('Unlock') })).toBeDisabled()
    expect(runtime.unlock).not.toHaveBeenCalled()
  })

  it('sends the password, and explains each way it can fail in plain words', async () => {
    const user = userEvent.setup()
    draw()
    const input = await screen.findByLabelText(t('Password'))
    for (const [result, message] of [
      ['wrong', t('Wrong password.')],
      ['wait', t('Too many tries. Wait {n} seconds.', { n: 7 })],
      ['tab', t('Aster is open in another window. Close it and try again.')],
      ['error', t('The data could not be opened.')],
    ] as const) {
      runtime.unlock.mockResolvedValueOnce(result)
      await user.clear(input)
      await user.type(input, 'пароль-для-проверки')
      await user.click(screen.getByRole('button', { name: t('Unlock') }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
    }
    expect(runtime.unlock).toHaveBeenLastCalledWith({ kind: 'password', password: 'пароль-для-проверки' })
  })

  it('switches to the recovery key and sends it as one', async () => {
    const user = userEvent.setup()
    draw()
    await user.click(await screen.findByRole('button', { name: t('I forgot the password') }))
    runtime.unlock.mockResolvedValueOnce('wrong')
    await user.type(screen.getByLabelText(t('Recovery key')), 'AAAAA-BBBBB')
    await user.click(screen.getByRole('button', { name: t('Unlock') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('That recovery key does not match.'))
    expect(runtime.unlock).toHaveBeenCalledWith({ kind: 'recovery', key: 'AAAAA-BBBBB' })
    await user.click(screen.getByRole('button', { name: t('Use the password instead') }))
    expect(screen.getByLabelText(t('Password'))).toHaveValue('')
  })

  it('opens with a passkey, and says so when it did not work', async () => {
    const user = userEvent.setup()
    draw()
    runtime.unlock.mockResolvedValueOnce('ok')
    await user.click(await screen.findByRole('button', { name: t('Use a passkey') }))
    await waitFor(() => expect(runtime.unlock).toHaveBeenCalledWith({ kind: 'passkey', credentialId: 'cred', secret: expect.any(Uint8Array) }))

    const { askVaultPasskey } = await import('@/vault/passkey')
    vi.mocked(askVaultPasskey).mockRejectedValueOnce(new Error('no'))
    await user.click(screen.getByRole('button', { name: t('Use a passkey') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('The passkey did not work.'))
  })

  it('erasing everything asks first, and can be cancelled', async () => {
    const user = userEvent.setup()
    draw()
    await user.click(await screen.findByRole('button', { name: t('I lost everything: start over') }))
    await user.click(screen.getByRole('button', { name: t('Cancel') }))
    expect(runtime.eraseEverything).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: t('I lost everything: start over') }))
    await user.click(screen.getByRole('button', { name: t('Delete everything') }))
    expect(runtime.eraseEverything).toHaveBeenCalledTimes(1)
  })
})

describe('the gate in front of the app', () => {
  const app = (ready: () => void) => <LocaleRoot><VaultGate onReady={ready}><p>приложение</p></VaultGate></LocaleRoot>

  it('with encryption on, boots the vault, shows the lock, and shows the app (announcing it once) when open', async () => {
    useVaultState.setState({ state: 'checking' })
    const ready = vi.fn()
    render(app(ready))
    expect(await screen.findByText(t('Aster is locked'))).toBeInTheDocument()
    expect(runtime.boot).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('приложение')).toBeNull()
    expect(ready).not.toHaveBeenCalled()
    act(() => useVaultState.setState({ state: 'unlocked' }))
    expect(await screen.findByText('приложение')).toBeInTheDocument()
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('with encryption off, steps aside at once and never loads the vault', async () => {
    backend.journalExists.mockResolvedValueOnce(false)
    useVaultState.setState({ state: 'checking' })
    const ready = vi.fn()
    render(app(ready))
    expect(await screen.findByText('приложение')).toBeInTheDocument()
    expect(runtime.boot).not.toHaveBeenCalled()
    expect(backend.selectNativeBackend).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('when the browser cannot say, the hint left by the vault decides', async () => {
    backend.journalExists.mockResolvedValueOnce(null)
    localStorage.setItem('aster.vault', '1')
    useVaultState.setState({ state: 'checking' })
    render(app(vi.fn()))
    expect(await screen.findByText(t('Aster is locked'))).toBeInTheDocument()
    localStorage.removeItem('aster.vault')
  })
})
