import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUI } from '@/app/store'
import { StorageBanner } from '@/components/StorageBanner'
import { db } from '@/data/db'
import { resolveFull, useStorageHealth } from '@/lib/storageHealth'
import { resetDb } from '../helpers'

beforeEach(async () => {
  await resetDb()
  resolveFull()
  useStorageHealth.setState({ usage: null, quota: null, failedAt: null })
  useUI.setState({ sheet: null, toasts: [] })
})

describe('the notice about a full storage', () => {
  it('shows nothing while there is room', () => {
    render(<StorageBanner />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says plainly that the last change was not saved, as an alert', async () => {
    render(<StorageBanner />)
    act(() => useStorageHealth.setState({ full: true }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Хранилище переполнено')
    expect(alert).toHaveTextContent('Последнее изменение не сохранилось')
  })

  it('offers a backup, which opens the backup sheet', async () => {
    const user = userEvent.setup()
    render(<StorageBanner />)
    act(() => useStorageHealth.setState({ full: true }))
    await user.click(await screen.findByRole('button', { name: 'Сделать резервную копию' }))
    expect(useUI.getState().sheet).toEqual({ kind: 'backup' })
  })

  it('"free up space" clears what can be rebuilt, keeps the people, and removes the alert', async () => {
    const user = userEvent.setup()
    await db.aiCache.add({ key: 'k', at: 1, value: 'x' } as never)
    await db.settings.put({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1 } as never)
    render(<StorageBanner />)
    act(() => useStorageHealth.setState({ full: true }))
    await user.click(await screen.findByRole('button', { name: 'Освободить место' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(await db.aiCache.count()).toBe(0)
    expect((await db.settings.get('me'))?.name).toBe('Макс')
    expect(useUI.getState().toasts.at(-1)?.text).toBe('Место освобождено')
  })

  it('the early warning is a status, not an alert, and can be closed', async () => {
    const user = userEvent.setup()
    render(<StorageBanner />)
    act(() => useStorageHealth.setState({ usage: 95, quota: 100 }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('почти заполнено')
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a refusal cannot be closed away: it comes back as an alert and stays until writes work', async () => {
    const user = userEvent.setup()
    render(<StorageBanner />)
    act(() => useStorageHealth.setState({ full: true, dismissed: true }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
