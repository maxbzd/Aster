// Proves, in a real Chromium, what the app does when the browser refuses a write for lack of room:
// the refused change is announced at once, nothing saved earlier is damaged, and once there is room again the notice goes away.
// (Chromium cannot be given a small allowance from a script, so the refusal is simulated at the one place the app is exposed to
// it: the browser's `put` and `add` throw `QuotaExceededError`, exactly the error a full disk raises.)
//
//   npm run build && npm run preview -- --port 4174 --strictPort     (in another terminal)
//   BASE_URL=http://localhost:4174/ npm run e2e:quota
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { fallbackChromiumPath } from './chromium.ts'

const BASE = (process.env.BASE_URL ?? 'http://localhost:4174/').replace(/#.*$/, '')
const executablePath = fallbackChromiumPath()
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })
const step = (text) => console.log(`• ${text}`)

/** Raw IndexedDB helpers, run inside the page: the app's own database is read the way a person's browser would. */
const peopleCount = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('aster')
        open.onsuccess = () => {
          const request = open.result.transaction('people').objectStore('people').count()
          request.onsuccess = () => { open.result.close(); resolve(request.result) }
          request.onerror = () => reject(request.error)
        }
        open.onerror = () => reject(open.error)
      }),
  )

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /get started/i }).click()
  await page.getByRole('textbox').fill('Tester')
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByRole('button', { name: /see an example/i }).click()
  await page.waitForTimeout(2500)
  const before = await peopleCount(page)
  assert.ok(before >= 5, 'the example data is there')
  step(`${before} people saved`)

  // from here on the browser refuses every write
  await page.evaluate(() => {
    const refuse = (original) =>
      function (...args) {
        if (window.__storageFull) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        return original.apply(this, args)
      }
    IDBObjectStore.prototype.put = refuse(IDBObjectStore.prototype.put)
    IDBObjectStore.prototype.add = refuse(IDBObjectStore.prototype.add)
    window.__storageFull = true
  })

  // a change that cannot be saved
  await page.locator('button[aria-label="Add"]').first().click()
  await page.getByRole('button', { name: /new person/i }).click()
  await page.getByPlaceholder('First name').fill('Zzz Refused')
  await page.getByRole('button', { name: 'Add to network' }).click()
  const alert = page.getByRole('alert').filter({ hasText: 'Storage is full' })
  await alert.waitFor()
  step('the person is told at once: "Storage is full"')
  assert.equal(await peopleCount(page), before, 'the refused person was not half-saved')
  assert.ok((await page.getByRole('alert').innerText()).includes('not saved'), 'the notice says the change was not saved')
  step('nothing saved earlier was touched')

  // room again: the same change now works and the notice disappears by itself
  await page.evaluate(() => { window.__storageFull = false })
  await page.getByRole('button', { name: 'Add to network' }).click()
  await alert.waitFor({ state: 'detached' })
  await page.waitForTimeout(500)
  assert.equal(await peopleCount(page), before + 1, 'the person is saved once there is room')
  step('with room again the change is saved and the notice is gone')
  console.log('OK')
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await browser.close()
}
