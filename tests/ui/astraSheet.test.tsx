import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '@/app/store'
import { useCloud } from '@/cloud/store'
import { db } from '@/data/db'
import { LocaleRoot } from '@/i18n/react'
import { t } from '@/i18n'
import { seed } from './harness'

const server = vi.hoisted(() => ({ status: null as null | Record<string, unknown> }))
const test = vi.hoisted(() => ({ result: { ok: true, message: 'привет' } as { ok: boolean; message: string } }))
vi.mock('@/ai/astra', async orig => ({ ...(await orig<typeof import('@/ai/astra')>()), testConnection: vi.fn(async () => test.result) }))

import { AstraSheet } from '@/sheets/AstraSheet'

const draw = () => {
  const onClose = vi.fn()
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  render(<LocaleRoot><MemoryRouter><AstraSheet onClose={onClose} /></MemoryRouter></LocaleRoot>)
  return { user, onClose }
}
const ai = async () => (await db.settings.get('me'))?.ai
const full = { allowed: true, anthropic: true, gemini: true, groq: false, gateway: false, gatewayModels: [], stt: true }

beforeEach(async () => {
  await seed({ demo: false })
  server.status = null
  // the server's "status" answer, as the real function would give it (nothing when there is no function)
  vi.stubGlobal('fetch', vi.fn(async () => server.status ? new Response(JSON.stringify(server.status)) : new Response('', { status: 404 })))
  test.result = { ok: true, message: 'привет' }
  useUI.setState({ sheet: null, toasts: [] })
  act(() => useCloud.setState({ userId: undefined } as never))
})

describe('connecting Astra to a model', () => {
  it('on the device by default: no model list, no key field', async () => {
    draw()
    expect(await screen.findByText(t('Runs on this device'))).toBeInTheDocument()
    expect(screen.queryByText(t('Model'))).toBeNull()
  })

  it('"Own key": the key is kept, can be shown, and the model is chosen', async () => {
    const { user } = draw()
    await user.click(await screen.findByRole('button', { name: t('Own key') }))
    const key = await screen.findByPlaceholderText('sk-ant-…')
    expect(key).toHaveAttribute('type', 'password')
    await user.type(key, ' sk-ant-123 ')
    await user.tab()
    await waitFor(async () => expect((await ai())?.apiKey).toBe('sk-ant-123'))
    await user.click(screen.getByRole('button', { name: t('Show') }))
    expect(key).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: t('Hide') }))
    expect(key).toHaveAttribute('type', 'password')
    const models = within(screen.getByText(t('Model')).nextElementSibling as HTMLElement).getAllByRole('button')
    await user.click(models[models.length - 1]!)
    await waitFor(async () => expect((await ai())?.model).toBeTruthy())
  })

  it('the cloud model needs consent before it can be tested; privacy switches are saved', async () => {
    const { user } = draw()
    await user.click(await screen.findByRole('button', { name: t('Own key') }))
    const run = await screen.findByRole('button', { name: t('Test connection') })
    expect(run).toBeDisabled()
    expect(screen.getByText(t('Tick the consent above to turn on the cloud model.'))).toBeInTheDocument()
    const notes0 = (await ai())?.shareNotes ?? true
    const web0 = (await ai())?.webSearch ?? true
    await user.click(screen.getByRole('button', { name: new RegExp(t('Share notes and history')) }))
    await waitFor(async () => expect((await ai())?.shareNotes).toBe(!notes0))
    await user.click(screen.getByRole('button', { name: new RegExp(t('Look up news about people')) }))
    await waitFor(async () => expect((await ai())?.webSearch).toBe(!web0))
    await user.click(screen.getByRole('button', { name: new RegExp(t('I understand how my data is processed')) }))
    await waitFor(async () => expect((await ai())?.consentAt).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: t('Test connection') })).toBeEnabled()
    // taking the consent back switches the test off again
    await user.click(screen.getByRole('button', { name: new RegExp(t('I understand how my data is processed')) }))
    await waitFor(async () => expect((await ai())?.consentAt).toBeUndefined())
  })

  it('the test says it works, or why it does not', async () => {
    const { user } = draw()
    await user.click(await screen.findByRole('button', { name: t('Own key') }))
    await user.click(await screen.findByRole('button', { name: new RegExp(t('I understand how my data is processed')) }))
    await user.click(await screen.findByRole('button', { name: t('Test connection') }))
    expect(await screen.findByText(t('✓ Works: “{message}”', { message: 'привет' }))).toBeInTheDocument()
    test.result = { ok: false, message: 'Неверный ключ' }
    await user.click(screen.getByRole('button', { name: t('Test connection') }))
    expect(await screen.findByText('Неверный ключ')).toBeInTheDocument()
  })

  it('"Server" without a cloud account asks to sign in', async () => {
    const { user } = draw()
    await user.click(await screen.findByRole('button', { name: t('Server') }))
    await user.click(await screen.findByRole('button', { name: t('Sign in to the cloud') }))
    expect(useUI.getState().sheet).toEqual({ kind: 'cloud' })
  })

  describe('signed in, server mode', () => {
    beforeEach(() => { act(() => useCloud.setState({ userId: 'u1' } as never)) })

    it('no answer from the server: says it is checking', async () => {
      const { user } = draw()
      await user.click(await screen.findByRole('button', { name: t('Server') }))
      expect(await screen.findByText(new RegExp(t('Checking the server…').slice(0, 20)))).toBeInTheDocument()
    })

    it('an account that is not allowed, and a server with no key, are told apart', async () => {
      server.status = { ...full, allowed: false }
      const a = draw()
      await a.user.click(await screen.findByRole('button', { name: t('Server') }))
      expect(await screen.findByText(t("This account can't use the server key. The owner needs to add its email to the ALLOWED_EMAILS secret of the ai function in Supabase."))).toBeInTheDocument()
    })

    it('no AI key on the server', async () => {
      server.status = { ...full, anthropic: false, gemini: false }
      const { user } = draw()
      await user.click(await screen.findByRole('button', { name: t('Server') }))
      expect(await screen.findByText(t('No AI key is set on the server (the GEMINI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY or GATEWAY_API_KEY secrets of the ai function in Supabase).'))).toBeInTheDocument()
    })

    it('a connected server: nothing to enter; models of the server are offered; the comparison page opens', async () => {
      server.status = full
      const { user, onClose } = draw()
      await user.click(await screen.findByRole('button', { name: t('Server') }))
      expect(await screen.findByText(t('✓ Server key connected. No need to enter it on the device.'))).toBeInTheDocument()
      await waitFor(async () => expect((await ai())?.mode).toBe('managed'))
      await user.click(screen.getByRole('button', { name: t('Compare models on test tasks') }))
      expect(onClose).toHaveBeenCalled()
    })

    it('a server key already there is offered in one tap while the sheet is on "Device"', async () => {
      server.status = full
      const { user } = draw()
      await user.click(await screen.findByRole('button', { name: new RegExp(t('Server key is already connected')) }))
      await waitFor(async () => expect((await ai())?.mode).toBe('managed'))
    })

    it('going back from the server to an own key resets a model that exists only on the server', async () => {
      server.status = { ...full, gateway: true, gatewayModels: ['acme/x-1'] }
      const { user } = draw()
      await user.click(await screen.findByRole('button', { name: t('Server') }))
      await waitFor(async () => expect((await ai())?.mode).toBe('managed'))
      await user.click(await screen.findByRole('button', { name: t('Own key') }))
      await waitFor(async () => expect((await ai())?.mode).toBe('key'))
      expect((await ai())?.model).toMatch(/claude/)
    })
  })
})

describe('speech recognition and voice settings (inside the same sheet)', () => {
  const sttOf = async () => (await db.settings.get('me'))?.stt
  const voiceOf = async () => (await db.settings.get('me'))?.voice

  it('switching on recognition picks the default service; with a key typed, it reads "ready"', async () => {
    const { user } = draw()
    await user.click(screen.getAllByRole('switch')[0]!)
    await waitFor(async () => expect((await sttOf())?.provider).toBe('openai'))
    const key = await screen.findByPlaceholderText(t('Paste the key'))
    await user.type(key, 'sk-test')
    await user.tab()
    await waitFor(async () => expect((await sttOf())?.apiKey).toBe('sk-test'))
    expect(await screen.findByText(new RegExp(t('✓ Ready: the “Upload a recording” button on the “Dictate a meeting” screen').slice(0, 10)))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('Show key') }))
    expect(key).toHaveAttribute('type', 'text')
    // the address is editable
    const address = screen.getByPlaceholderText('https://api.openai.com/v1')
    await user.clear(address)
    await user.type(address, 'https://stt.example/v1')
    await user.tab()
    await waitFor(async () => expect((await sttOf())?.baseUrl).toBe('https://stt.example/v1'))
    // clearing the key removes it
    await user.clear(key)
    await user.tab()
    await waitFor(async () => expect((await sttOf())?.apiKey).toBeUndefined())
  })

  it('the presets change the address and the model; switching off turns the service off', async () => {
    const { user } = draw()
    await user.click(screen.getAllByRole('switch')[0]!)
    await waitFor(async () => expect((await sttOf())?.provider).toBe('openai'))
    const presetButtons = () => screen.getAllByRole('button').filter(b => /Groq|OpenAI|Whisper/i.test(b.textContent ?? ''))
    await waitFor(() => expect(presetButtons().length).toBeGreaterThan(1))
    await user.click(presetButtons().at(-1)!)
    await waitFor(async () => expect((await sttOf())?.baseUrl).toBeTruthy())
    await user.click(screen.getAllByRole('switch')[0]!)
    await waitFor(async () => expect((await sttOf())?.provider).toBe('off'))
  })

  it('with a server key for recognition, the server is used by default and "Own key" can be chosen', async () => {
    server.status = full
    act(() => useCloud.setState({ userId: 'u1' } as never))
    const { user } = draw()
    await user.click(screen.getAllByRole('switch')[0]!)
    await waitFor(async () => expect((await sttOf())?.provider).toBe('managed'))
    expect(await screen.findByText(t('✓ Using the server key: nothing to enter.'))).toBeInTheDocument()
    // two "Own key" buttons exist now: the model's connection mode, and this one under the recognition switch
    const own = screen.getAllByRole('button', { name: t('Own key') })
    await user.click(own[own.length - 1]!)
    await waitFor(async () => expect((await sttOf())?.provider).toBe('openai'))
    await user.click(await screen.findByRole('button', { name: t('Key on the server') }))
    await waitFor(async () => expect((await sttOf())?.provider).toBe('managed'))
  })

  it('"Ask out loud" is saved; "Listen for Astra" is saved where the browser can listen', async () => {
    ;(window as unknown as Record<string, unknown>).SpeechRecognition = class {}
    const { user } = draw()
    const switches = await screen.findAllByRole('switch')
    await user.click(switches[switches.length - 1]!)
    await waitFor(async () => expect((await voiceOf())?.speak).toBe(true))
    await user.click(switches[switches.length - 2]!)
    await waitFor(async () => expect((await voiceOf())?.wake).toBe(true))
    delete (window as unknown as Record<string, unknown>).SpeechRecognition
  })
})
