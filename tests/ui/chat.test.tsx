import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { renderApp, seed } from './harness'

beforeEach(async () => {
  await seed({ demo: false })
  await db.people.bulkAdd([
    personOf('olga', { firstName: 'Ольга', role: 'Керамист', city: 'Лиссабон', notes: 'любит джаз' }),
    personOf('igor', { firstName: 'Игорь', role: 'Инвестор' }),
  ])
})

describe('the chat with Astra (answering on the device, with no model connected)', () => {
  it('starts empty with examples to try, and clearing is not offered while there is nothing to clear', async () => {
    renderApp('/chat')
    expect(await screen.findByText(new RegExp(t('Ask what you remember')))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('Clear chat') })).toBeDisabled()
    expect(screen.getByRole('button', { name: t('Send') })).toBeDisabled()
  })

  it('answers a question about a person, keeps the conversation, and clears it on request', async () => {
    const { user } = renderApp('/chat')
    const box = await screen.findByPlaceholderText(t('Ask about people and conversations'))
    await user.type(box, 'Что я знаю про Ольгу?')
    await user.click(screen.getByRole('button', { name: t('Send') }))
    await waitFor(async () => expect((await db.chat.orderBy('at').toArray()).map(m => m.role)).toEqual(['user', 'astra']), { timeout: 8000 })
    const [asked, answered] = await db.chat.orderBy('at').toArray()
    expect(asked!.text).toBe('Что я знаю про Ольгу?')
    expect(answered!.text.length).toBeGreaterThan(10)
    expect(answered!.source).toBe('local')
    expect(await screen.findByText('Что я знаю про Ольгу?')).toBeInTheDocument()
    expect((box as HTMLTextAreaElement).value).toBe('') // the field is ready for the next question

    await user.click(screen.getByRole('button', { name: t('Clear chat') }))
    await waitFor(async () => expect(await db.chat.count()).toBe(0))
    expect(screen.getByRole('button', { name: t('Clear chat') })).toBeDisabled()
  })

  it('a question that arrives in the address (from the search or from Today) is asked at once', async () => {
    renderApp('/chat?q=%D0%9A%D1%82%D0%BE%20%D0%98%D0%B3%D0%BE%D1%80%D1%8C%3F')
    await waitFor(async () => expect((await db.chat.toArray()).some(m => m.role === 'user' && m.text === 'Кто Игорь?')).toBe(true), { timeout: 8000 })
    await waitFor(() => expect(window.location.hash).toBe('#/chat')) // and the question is taken out of the address
    // let the answer land too, or it is written into the next test's empty chat
    await waitFor(async () => expect((await db.chat.toArray()).some(m => m.role === 'astra')).toBe(true), { timeout: 8000 })
  })

  it('an empty or blank question is never sent', async () => {
    const { user } = renderApp('/chat')
    const box = await screen.findByPlaceholderText(t('Ask about people and conversations'))
    await user.type(box, '   ')
    expect(screen.getByRole('button', { name: t('Send') })).toBeDisabled()
    expect(await db.chat.count()).toBe(0)
  })
})
