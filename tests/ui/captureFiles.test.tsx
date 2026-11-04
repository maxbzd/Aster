import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '@/app/store'
import { t } from '@/i18n'
import { renderApp, seed } from './harness'

const picked = vi.hoisted(() => ({ file: null as File | null, accept: '' }))
vi.mock('@/lib/image', async original => ({
  ...(await original<typeof import('@/lib/image')>()),
  pickFile: async (accept: string) => { picked.accept = accept; return picked.file },
}))

beforeEach(async () => { picked.file = null; picked.accept = ''; await seed({ demo: false }); useUI.setState({ sheet: null, toasts: [] }) })

const textArea = async () => (await screen.findByRole('textbox')) as HTMLTextAreaElement

describe('a transcript from a file', () => {
  it('a plain text file fills the note, and the screen goes to text mode', async () => {
    picked.file = new File(['Встретился с Мариной на конференции. Она ищет дизайнера.'], 'заметка.txt', { type: 'text/plain' })
    const { user } = renderApp('/capture?mode=text')
    await textArea()
    await user.click(await screen.findByRole('button', { name: t('Upload a transcript') }))
    await waitFor(async () => expect((await textArea()).value).toContain('Встретился с Мариной'))
    expect(picked.accept).toContain('.txt')
    expect(useUI.getState().toasts.some(x => x.text.startsWith(t('Transcript loaded: {v} characters', { v: '' }).slice(0, 12)))).toBe(true)
  })

  it('a subtitle file (.srt) loses its numbers and timings, and keeps what was said', async () => {
    picked.file = new File(['1\n00:00:01,000 --> 00:00:03,000\nПривет, я Олег.\n\n2\n00:00:04,000 --> 00:00:06,000\nЯ работаю в логистике.\n'], 'встреча.srt', { type: 'text/plain' })
    const { user } = renderApp('/capture?mode=text')
    await textArea()
    await user.click(await screen.findByRole('button', { name: t('Upload a transcript') }))
    await waitFor(async () => expect((await textArea()).value).toContain('Привет, я Олег.'))
    const value = (await textArea()).value
    expect(value).toContain('Я работаю в логистике.')
    expect(value).not.toContain('-->')
  })

  it('an empty file says so and changes nothing', async () => {
    picked.file = new File(['   '], 'пусто.txt', { type: 'text/plain' })
    const { user } = renderApp('/capture?mode=text')
    await textArea()
    await user.click(await screen.findByRole('button', { name: t('Upload a transcript') }))
    await waitFor(() => expect(useUI.getState().toasts.map(x => x.text)).toContain(t('No text in the file')))
    expect((await textArea()).value).toBe('')
  })

  it('cancelling the file picker does nothing', async () => {
    picked.file = null
    const { user } = renderApp('/capture?mode=text')
    await textArea()
    await user.click(await screen.findByRole('button', { name: t('Upload a transcript') }))
    expect(useUI.getState().toasts).toEqual([])
  })
})

describe('a meeting recording', () => {
  it('without a recognition key, explains and opens the settings instead of reading the file', async () => {
    picked.file = new File([new Uint8Array(10)], 'встреча.m4a', { type: 'audio/mp4' })
    const { user } = renderApp('/capture?mode=text')
    await textArea()
    await user.click(await screen.findByRole('button', { name: t('Upload a meeting recording') }))
    await waitFor(() => expect(useUI.getState().toasts.map(x => x.text)).toContain(t("First add a recognition key in Astra's settings")))
    expect(useUI.getState().sheet).toEqual({ kind: 'astra' })
    expect(picked.accept).toBe('') // the file picker was not even opened
  })

  it('the way back from text mode and the review step', async () => {
    const { user } = renderApp('/capture?mode=text')
    const box = await textArea()
    await user.click(box)
    await user.paste('Познакомился с Артёмом Беловым на ужине у Алины — он CTO в финтехе.')
    await user.click(await screen.findByRole('button', { name: /Разобрать/ }))
    expect(await screen.findByText(/Вот что я поняла/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('Edit') }))
    expect((await textArea()).value).toContain('Артёмом')
  })
})
