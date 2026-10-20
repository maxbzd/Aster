import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import App from '@/app/App'
import { useUI } from '@/app/store'
import { LocaleRoot } from '@/i18n/react'
import { DEFAULT_CIRCLES, saveSettings, setCircles } from '@/data/actions'
import { resetDb } from '../helpers'

/** A clean database plus a person who has gone through onboarding. `demo` means 32 people and 23 contacts in the reserve. */
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
  return { user, ...render(<LocaleRoot><App /></LocaleRoot>) }
}

/** Catches React errors and warnings (nested buttons, keys, act…): they must not appear. */
export function watchConsole() {
  const bad: string[] = []
  const grab = (...a: unknown[]) => { bad.push(a.map(x => String(x)).join(' ').slice(0, 300)) }
  vi.spyOn(console, 'error').mockImplementation(grab)
  vi.spyOn(console, 'warn').mockImplementation(grab)
  return bad
}
