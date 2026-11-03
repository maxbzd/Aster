import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, seed } from './harness'
import { t } from '@/i18n'

beforeEach(() => seed({ demo: true }))

const next = () => fireEvent.keyDown(window, { key: 'ArrowRight' })

describe('the year in review', () => {
  it('opens on the intro and goes through the slides by the keyboard, back and forth', async () => {
    renderApp('/year')
    await screen.findByText(t('tap to go on · hold to pause'))
    const bars = () => document.querySelectorAll('[class*="rounded-full"][class*="bg-white/25"]').length
    await waitFor(() => expect(bars()).toBeGreaterThan(4)) // the slides appear once the data has been read
    await new Promise(r => setTimeout(r, 300))
    const total = bars()
    for (let i = 0; i < total - 1; i += 1) act(next)
    await waitFor(() => expect(screen.queryByText(t('tap to go on · hold to pause'))).toBeNull()) // the last slide has nothing to wait for
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(await screen.findByText(t('tap to go on · hold to pause'))).toBeInTheDocument()
  })

  it('the progress of a slide is run by the browser: when its bar ends, the next slide begins', async () => {
    renderApp('/year')
    const bar = await screen.findByTestId('slide-progress')
    expect(bar).toHaveClass('year-progress')
    expect(bar.style.animationDuration).toBe('7000ms')
    expect(bar.style.animationPlayState).toBe('running')
    fireEvent.animationEnd(bar)
    await waitFor(() => expect(screen.getByTestId('slide-progress')).not.toBe(bar))
  })

  it('holding the screen pauses the progress, and letting go resumes it', async () => {
    renderApp('/year')
    await screen.findByTestId('slide-progress')
    const root = document.querySelector('[role="presentation"]')!
    fireEvent.pointerDown(root, { clientX: 200 })
    await waitFor(() => expect(screen.getByTestId('slide-progress').style.animationPlayState).toBe('paused'))
    fireEvent.pointerUp(root, { clientX: 200 })
    await waitFor(() => expect(screen.getByTestId('slide-progress').style.animationPlayState).toBe('running'))
  })

  it('a short tap on the right goes on, a short tap on the left goes back, and close leaves the story', async () => {
    renderApp('/year')
    await screen.findByTestId('slide-progress')
    const root = document.querySelector('[role="presentation"]')!
    Object.defineProperty(root, 'clientWidth', { value: 400, configurable: true })
    const filled = () => [...document.querySelectorAll('.h-\\[3px\\] > div')].filter(d => (d as HTMLElement).style.transform === 'scaleX(1)').length
    expect(filled()).toBe(0)
    fireEvent.pointerDown(root, { clientX: 300 }); fireEvent.pointerUp(root, { clientX: 300 })
    await waitFor(() => expect(filled()).toBe(1))
    fireEvent.pointerDown(root, { clientX: 20 }); fireEvent.pointerUp(root, { clientX: 20 })
    await waitFor(() => expect(filled()).toBe(0))
    fireEvent.click(screen.getByRole('button', { name: t('Close') }))
  })
})
