import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCloud } from '@/cloud/store'
import { useUI } from '@/app/store'
import { LocaleRoot } from '@/i18n/react'
import { t } from '@/i18n'

const keys = vi.hoisted(() => ({
  list: [] as { id: string; label: string; last_used_at: string | null; created_at: string }[],
  failNext: false,
}))
vi.mock('@/mcp/keys', () => ({
  listKeys: vi.fn(async () => { if (keys.failNext) { keys.failNext = false; throw new Error('Не удалось получить ключи') } return keys.list }),
  createKey: vi.fn(async (label: string) => { keys.list = [...keys.list, { id: `k${keys.list.length + 1}`, label, last_used_at: null, created_at: new Date().toISOString() }]; return { id: 'new', url: `https://example.test/mcp/${label}-secret` } }),
  revokeKey: vi.fn(async (id: string) => { keys.list = keys.list.filter(k => k.id !== id) }),
}))

import { ClaudeSheet } from '@/sheets/ClaudeSheet'

const draw = () => render(<LocaleRoot><ClaudeSheet onClose={vi.fn()} /></LocaleRoot>)
beforeEach(() => { keys.list = []; keys.failNext = false; useUI.setState({ sheet: null, toasts: [] }); act(() => useCloud.setState({ userId: undefined } as never)) })

describe('connecting Claude', () => {
  it('without a cloud account, asks to sign in first and leads there', async () => {
    const user = userEvent.setup()
    draw()
    await user.click(await screen.findByRole('button', { name: t('Sign in to the cloud') }))
    expect(useUI.getState().sheet).toEqual({ kind: 'cloud' })
  })

  describe('signed in', () => {
    beforeEach(() => { act(() => useCloud.setState({ userId: 'u1' } as never)) })

    it('says there are no keys yet, makes one, shows its address once, and the key appears in the list', async () => {
      const user = userEvent.setup()
      draw()
      expect(await screen.findByText(t('No keys yet.'))).toBeInTheDocument()
      const name = screen.getByLabelText(t('Key name'))
      await user.clear(name)
      await user.type(name, 'Ноутбук')
      await user.click(screen.getByRole('button', { name: t('Create key') }))
      const address = await screen.findByLabelText(t('Address for Claude'))
      expect((address as HTMLTextAreaElement).value).toBe('https://example.test/mcp/Ноутбук-secret')
      expect(await screen.findByText('Ноутбук', { selector: 'div.truncate' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: t('Copy address') }))
      expect(await navigator.clipboard.readText()).toBe('https://example.test/mcp/Ноутбук-secret')
      await user.click(screen.getByRole('button', { name: t("Done, I've copied it") }))
      expect(screen.queryByLabelText(t('Address for Claude'))).toBeNull() // shown only once
    })

    it('lists the keys and revokes one', async () => {
      keys.list = [{ id: 'k1', label: 'Рабочий', last_used_at: null, created_at: new Date().toISOString() }, { id: 'k2', label: 'Домашний', last_used_at: new Date().toISOString(), created_at: new Date().toISOString() }]
      const user = userEvent.setup()
      draw()
      expect(await screen.findByText('Рабочий')).toBeInTheDocument()
      expect(screen.getByText(t('never used yet'))).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: t('Revoke key “{label}”', { label: 'Рабочий' }) }))
      await waitFor(() => expect(screen.queryByText('Рабочий')).toBeNull())
      expect(screen.getByText('Домашний')).toBeInTheDocument()
      expect(useUI.getState().toasts.at(-1)?.text).toBe(t('Key revoked'))
    })

    it('shows what went wrong instead of an empty list', async () => {
      keys.failNext = true
      draw()
      expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось получить ключи')
    })
  })
})
