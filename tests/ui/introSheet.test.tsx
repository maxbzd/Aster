import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '@/app/store'
import { db } from '@/data/db'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { renderApp, seed } from './harness'

const contact = vi.hoisted(() => ({ opened: [] as string[] }))
vi.mock('@/lib/contact', async original => ({ ...(await original<typeof import('@/lib/contact')>()), openChannel: (c: { value: string }) => { contact.opened.push(c.value) } }))

const dialog = () => within(screen.getByRole('dialog'))
const open = () => act(() => useUI.getState().open({ kind: 'intro', aId: 'a', bId: 'b', reason: 'Оба строят керамические студии', value: 'Обменяются поставщиками глазури' }))

beforeEach(async () => {
  contact.opened = []
  await seed({ demo: false })
  await db.people.bulkAdd([
    personOf('a', { firstName: 'Анна', role: 'Керамист', channels: [{ type: 'telegram', value: '@anna' }] }),
    personOf('b', { firstName: 'Борис', role: 'Дизайнер', channels: [{ type: 'telegram', value: '@boris' }] }),
  ])
})
afterEach(() => { act(() => useUI.getState().close()) })

describe('an introduction', () => {
  it('shows the reason, writes a message for each person and one for the group, and lets them be edited', async () => {
    const { user } = renderApp('/people')
    await screen.findByText(/Анна/)
    open()
    await screen.findByRole('dialog')
    expect(await dialog().findByText('Оба строят керамические студии')).toBeInTheDocument()
    const box = (await dialog().findByRole('textbox')) as HTMLTextAreaElement
    await waitFor(() => expect(box.value.length).toBeGreaterThan(20))
    const toAnna = box.value
    await user.click(dialog().getByRole('button', { name: 'Борис' }))
    await waitFor(() => expect((dialog().getByRole('textbox') as HTMLTextAreaElement).value).not.toBe(toAnna))
    await user.click(dialog().getByRole('button', { name: t('Group chat') }))
    await user.clear(dialog().getByRole('textbox'))
    await user.type(dialog().getByRole('textbox'), 'Привет обоим!')
    expect((dialog().getByRole('textbox') as HTMLTextAreaElement).value).toBe('Привет обоим!')
  })

  it('"Send" copies the message, opens the person\'s chat and remembers that they were asked', async () => {
    const { user } = renderApp('/people')
    await screen.findByText(/Анна/)
    open()
    await screen.findByRole('dialog')
    const box = (await dialog().findByRole('textbox')) as HTMLTextAreaElement
    await waitFor(() => expect(box.value.length).toBeGreaterThan(20))
    await user.click(dialog().getByRole('button', { name: t('Send') }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(box.value))
    expect(contact.opened).toEqual(['@anna'])
    await waitFor(async () => expect((await db.intros.toArray()).map(i => i.status)).toEqual(['asked']))
  })

  it('the group message is only copied: nobody is opened and nobody is marked as asked', async () => {
    const { user } = renderApp('/people')
    await screen.findByText(/Анна/)
    open()
    await screen.findByRole('dialog')
    await waitFor(async () => expect(((await dialog().findByRole('textbox')) as HTMLTextAreaElement).value.length).toBeGreaterThan(20))
    await user.click(dialog().getByRole('button', { name: t('Group chat') }))
    await user.click(dialog().getByRole('button', { name: t('Copy') }))
    await waitFor(async () => expect((await navigator.clipboard.readText()).length).toBeGreaterThan(20))
    expect(contact.opened).toEqual([])
    expect(await db.intros.count()).toBe(0)
  })

  it('"Introduced" records it and closes; "Not a fit" hides the pair', async () => {
    const { user } = renderApp('/people')
    await screen.findByText(/Анна/)
    open()
    await screen.findByRole('dialog')
    await user.click(await dialog().findByRole('button', { name: new RegExp(t('Introduced')) }))
    await waitFor(async () => expect((await db.intros.toArray()).map(i => i.status)).toEqual(['done']))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await db.intros.clear()
    open()
    await screen.findByRole('dialog')
    await user.click(await dialog().findByRole('button', { name: t('Not a fit') }))
    await waitFor(async () => expect((await db.intros.toArray()).map(i => i.status)).toEqual(['dismissed']))
  })
})
