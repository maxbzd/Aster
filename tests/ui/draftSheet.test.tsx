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
const open = (personId: string) => act(() => useUI.getState().open({ kind: 'draft', personId }))
const textbox = async () => (await dialog().findByRole('textbox')) as HTMLTextAreaElement

beforeEach(async () => {
  contact.opened = []
  await seed({ demo: false })
})
afterEach(() => { act(() => useUI.getState().close()) })

describe('a message to a person', () => {
  it('writes a draft in three tones, and a change of tone changes the text', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга', channels: [{ type: 'telegram', value: '@olga' }] }))
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open('p1')
    await screen.findByRole('dialog')
    const box = await textbox()
    await waitFor(() => expect(box.value.length).toBeGreaterThan(10))
    const warm = box.value
    await user.click(dialog().getByRole('button', { name: t('Short') }))
    await waitFor(() => expect((dialog().getByRole('textbox') as HTMLTextAreaElement).value).not.toBe(warm))
    await user.click(dialog().getByRole('button', { name: t('To the point') }))
    await waitFor(() => expect((dialog().getByRole('textbox') as HTMLTextAreaElement).value.length).toBeGreaterThan(10))
  })

  it('sending copies the text, opens the chat, and offers to log it as a contact once the person has been written to', async () => {
    await db.people.add(personOf('p1', { firstName: 'Ольга', channels: [{ type: 'telegram', value: '@olga' }] }))
    const { user } = renderApp('/people')
    await screen.findByText(/Ольга/)
    open('p1')
    await screen.findByRole('dialog')
    const box = await textbox()
    await waitFor(() => expect(box.value.length).toBeGreaterThan(10))
    await user.clear(box)
    await user.type(box, 'Привет, Оля!')
    await user.click(dialog().getAllByRole('button').at(-1)!) // the main button of the footer: send through the person's channel
    await waitFor(() => expect(contact.opened).toEqual(['@olga']))
    expect(await navigator.clipboard.readText()).toBe('Привет, Оля!')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // a moment later the app offers to note it down; doing so records the message in the person's history
    const offer = await screen.findByRole('button', { name: t('Sent') }, { timeout: 3000 })
    await user.click(offer)
    await waitFor(async () => expect((await db.interactions.toArray()).some(i => i.personIds.includes('p1') && i.type === 'message')).toBe(true))
  })

  it('a person without contacts gets the text copied, and is told to add one', async () => {
    await db.people.add(personOf('p2', { firstName: 'Игорь' }))
    const { user } = renderApp('/people')
    await screen.findByText(/Игорь/)
    open('p2')
    await screen.findByRole('dialog')
    const box = await textbox()
    await waitFor(() => expect(box.value.length).toBeGreaterThan(10))
    await user.click(dialog().getByRole('button', { name: t('Copy text') }))
    await waitFor(() => expect(useUI.getState().toasts.map(x => x.text)).toContain(t('Copied — this person has no contacts, add them on the card')))
    expect(contact.opened).toEqual([])
  })

  it('the copy button copies without leaving, and the empty text cannot be sent', async () => {
    await db.people.add(personOf('p2', { firstName: 'Игорь' }))
    const { user } = renderApp('/people')
    await screen.findByText(/Игорь/)
    open('p2')
    await screen.findByRole('dialog')
    const box = await textbox()
    await waitFor(() => expect(box.value.length).toBeGreaterThan(10))
    await user.click(dialog().getByRole('button', { name: t('Copy') }))
    await waitFor(() => expect(useUI.getState().toasts.map(x => x.text)).toContain(t('Copied')))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.clear(box)
    expect(dialog().getByRole('button', { name: t('Copy text') })).toBeDisabled()
  })
})
