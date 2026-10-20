import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import App from '@/app/App'
import { useUI } from '@/app/store'
import { DEFAULT_CIRCLES, saveSettings, setCircles } from '@/data/actions'
import { resetDb } from '../helpers'

/** Чистая база + человек, прошедший онбординг. `demo` — 32 человека и 23 контакта в резерве. */
export async function seed({ demo = false, onboarded = true }: { demo?: boolean; onboarded?: boolean } = {}) {
  await resetDb()
  useUI.setState({ sheet: null, search: false, toasts: [] })
  if (!onboarded) return
  await saveSettings({ name: 'Макс', onboarded: true, createdAt: Date.now() - 10 * 86_400_000, demo })
  await setCircles(DEFAULT_CIRCLES)
  if (demo) await (await import('@/data/demo')).loadDemo()
}

export function renderApp(route = '/') {
  window.location.hash = `#${route}`
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  return { user, ...render(<App />) }
}

/** Ловит ошибки и предупреждения React (вложенные кнопки, ключи, act…) — они не должны появляться. */
export function watchConsole() {
  const bad: string[] = []
  const grab = (...a: unknown[]) => { bad.push(a.map(x => String(x)).join(' ').slice(0, 300)) }
  vi.spyOn(console, 'error').mockImplementation(grab)
  vi.spyOn(console, 'warn').mockImplementation(grab)
  return bad
}
