import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '@/app/store'
import { saveSettings } from '@/data/actions'
import { db } from '@/data/db'
import { t } from '@/i18n'
import { personOf } from '../cloud/rows'
import { renderApp, seed } from './harness'

/** The browser's recogniser, played by the test: it "hears" what the test says and can be dropped. */
class FakeRecognition {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  constructor() { FakeRecognition.instances.push(this) }
  start() {}
  stop() {}
  abort() {}
}
const live = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]!
const hear = (text: string) => act(() => {
  live().onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] })
})
const spoken: string[] = []

beforeEach(async () => {
  FakeRecognition.instances = []
  spoken.length = 0
  ;(window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition
  vi.stubGlobal('speechSynthesis', { cancel: () => undefined, speak: (u: { text: string }) => { spoken.push(u.text) } })
  vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; constructor(public text: string) {} })
  await seed({ demo: false })
  await db.people.bulkAdd([personOf('nina', { firstName: 'Нина', lastName: 'Козлова', role: 'Фотограф', city: 'Берлин', notes: 'любит кофе' })])
  await saveSettings({ voice: { wake: true, speak: true } as never })
})
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition
  vi.unstubAllGlobals()
})

const start = async () => {
  const ctx = renderApp('/')
  await waitFor(() => expect(FakeRecognition.instances.length).toBeGreaterThan(0))
  return ctx
}

describe('hands-free voice control', () => {
  it('shows the "Astra…" button only while listening is on; off, it is not there and the microphone is not used', async () => {
    await saveSettings({ voice: { wake: false, speak: false } as never })
    renderApp('/')
    await screen.findByText(/Нина|тонус|Сегодня/).catch(() => undefined)
    expect(screen.queryByRole('button', { name: new RegExp(t('“Astra…”')) })).toBeNull()
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('speech that does not start with the name is ignored', async () => {
    await start()
    await hear('какая сегодня погода')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('"Astra" alone is a call: it says it is listening, and the next phrase is taken as the command without the name', async () => {
    await start()
    await hear('Астра')
    expect(await screen.findByText(t('Listening — say a command'))).toBeInTheDocument()
    await hear('что я знаю про Нину')
    const dialog = await screen.findByRole('alertdialog', undefined, { timeout: 5000 })
    await waitFor(() => expect(dialog.textContent).toMatch(/Нин/), { timeout: 8000 })
  })

  it('a question is answered on the screen and read aloud; the card can be closed', async () => {
    const { user } = await start()
    await hear('Астра, что я знаю про Нину?')
    await waitFor(() => expect(screen.getByRole('alertdialog').textContent).toMatch(/Нин/), { timeout: 8000 })
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: t('Close') }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('a command to record shows the plan first and writes nothing; "no" cancels it', async () => {
    await start()
    const before = await db.interactions.count()
    await hear('Астра, запиши что мы с Ниной созвонились и договорились встретиться')
    expect(await screen.findByText(t('Check before I save'), undefined, { timeout: 8000 })).toBeInTheDocument()
    expect(await db.interactions.count()).toBe(before)
    await hear('нет')
    await waitFor(() => expect(screen.queryByText(t('Check before I save'))).toBeNull())
    expect(await db.interactions.count()).toBe(before)
    expect(useUI.getState().toasts.some(x => x.text === t('Cancelled, nothing saved'))).toBe(true)
  })

  it('"yes" by voice saves the plan', async () => {
    await start()
    const before = await db.interactions.count()
    await hear('Астра, запиши что мы с Ниной созвонились и договорились встретиться')
    await screen.findByText(t('Check before I save'), undefined, { timeout: 8000 })
    await hear('да')
    await waitFor(async () => expect(await db.interactions.count()).toBe(before + 1))
    await waitFor(() => expect(screen.queryByText(t('Check before I save'))).toBeNull())
  })

  it('the buttons do the same: "No" and "Yes, save"', async () => {
    const { user } = await start()
    const before = await db.interactions.count()
    await hear('Астра, запиши что мы с Ниной созвонились и договорились встретиться')
    await screen.findByText(t('Check before I save'), undefined, { timeout: 8000 })
    await user.click(screen.getByRole('button', { name: t('No') }))
    await waitFor(() => expect(screen.queryByText(t('Check before I save'))).toBeNull())
    await hear('Астра, запиши что мы с Ниной созвонились и договорились встретиться')
    await screen.findByText(t('Check before I save'), undefined, { timeout: 8000 })
    await user.click(screen.getByRole('button', { name: t('Yes, save') }))
    await waitFor(async () => expect(await db.interactions.count()).toBe(before + 1))
  })

  it('tapping the "Astra…" button opens a window for one command without the name', async () => {
    const { user } = await start()
    await user.click(await screen.findByRole('button', { name: new RegExp(t('“Astra…”')) }))
    expect(await screen.findByText(t('Listening — say a command'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('Close') }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('a denied microphone turns voice control off with a notice', async () => {
    await start()
    act(() => { live().onerror?.({ error: 'not-allowed' }) })
    await waitFor(() => expect(useUI.getState().toasts.some(x => x.text === t('No microphone access — voice control is off until restart'))).toBe(true))
    await waitFor(() => expect(screen.queryByRole('button', { name: new RegExp(t('“Astra…”')) })).toBeNull())
  })

  it('on the screens that use the microphone themselves it does not listen', async () => {
    renderApp('/chat')
    await screen.findByPlaceholderText(t('Ask about people and conversations'))
    expect(FakeRecognition.instances).toHaveLength(0)
  })
})
