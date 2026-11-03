// Three promises, checked in a real Chromium against the built app:
//   1. Privacy: with no account and no AI key, the app talks to nobody but its own origin.
//   2. Accessibility: no serious or critical axe-core violation (WCAG 2.2 AA) on any screen.
//   3. Offline: after the first visit, a reload with the network off still opens the app.
//
//   npm run build && npm run preview -- --port 4174 --strictPort     (in another terminal)
//   BASE_URL=http://localhost:4174/ npm run e2e:audit
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from '@playwright/test'
import { fallbackChromiumPath } from './chromium.ts'

const BASE = (process.env.BASE_URL ?? 'http://localhost:4174/').replace(/#.*$/, '')
const ROUTES = ['/', '/people', '/me', '/pulse', '/chat', '/orbit', '/year', '/graph', '/weak', '/review', '/capture', '/event', '/intros', '/weekly', '/reserve']
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

const executablePath = fallbackChromiumPath()
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })
const failures = []
try {
  // bypassCSP only so that axe can be injected; the app's own code is checked by e2e-vault.mjs under the real policy
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', bypassCSP: true })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)

  const foreign = new Set()
  context.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith(BASE.replace(/\/$/, '')) && !/^(data|blob):/.test(url)) foreign.add(`${request.resourceType()} ${url.slice(0, 100)}`)
  })

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /get started/i }).click()
  await page.getByRole('textbox').fill('Tester')
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByRole('button', { name: /see an example/i }).click()
  await page.waitForTimeout(2500)

  for (const route of ROUTES) {
    await page.evaluate((hash) => { location.hash = `#${hash}` }, route)
    await page.waitForTimeout(1000)
    await page.evaluate((source) => { if (!window.axe) { const s = document.createElement('script'); s.textContent = source; document.head.appendChild(s) } }, axeSource)
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
      return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ').slice(0, 80)}`)
    })
    if (violations.length) failures.push(`accessibility ${route}: ${violations.join('; ')}`)
    console.log(`• ${route.padEnd(10)} ${violations.length ? 'FAIL' : 'ok'}`)
  }

  if (foreign.size) failures.push(`privacy: requests to other origins: ${[...foreign].join(', ')}`)
  console.log(`• requests to other origins: ${foreign.size}`)

  await page.waitForTimeout(3000) // let the service worker finish caching
  await context.setOffline(true)
  await page.reload({ waitUntil: 'load', timeout: 20_000 })
  await page.waitForTimeout(1500)
  const text = (await page.locator('body').innerText()).trim()
  if (text.length < 20) failures.push('offline: the app did not open without a network')
  console.log(`• offline reload: ${text.length >= 20 ? 'ok' : 'FAIL'}`)

  assert.deepEqual(failures, [], failures.join('\n'))
  console.log('OK')
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await browser.close()
}
