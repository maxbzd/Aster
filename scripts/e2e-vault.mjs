// Proves, in a real Chromium, that "Protect this device" leaves nothing readable on disk.
//
//   npm run build && npm run preview -- --port 4174 --strictPort     (in another terminal)
//   BASE_URL=http://localhost:4174/ npm run e2e:vault
//
// It loads the example data, reads every IndexedDB store the way anyone with the browser's files could, turns the protection
// on, reads them again, then checks the locked app, a wrong password, the right password and the recovery key. It also
// fails on any content-policy or Trusted Types violation, console error or uncaught exception along the way.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { fallbackChromiumPath } from './chromium.ts'

const BASE = (process.env.BASE_URL ?? 'http://localhost:4174/').replace(/#.*$/, '')
const PASSWORD = 'correct-horse-battery-staple-42'

const executablePath = fallbackChromiumPath()
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' })
const page = await context.newPage()
page.setDefaultTimeout(30_000)

const problems = []
page.on('console', message => {
  if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 200)}`)
})
page.on('pageerror', error => problems.push(`uncaught: ${String(error).slice(0, 200)}`))
await page.addInitScript(() => {
  window.addEventListener('securitypolicyviolation', event => {
    ;(window.__violations ||= []).push(`${event.violatedDirective} ${(event.sample || '').slice(0, 80)}`)
  })
})

const step = text => console.log(`• ${text}`)

/** Every store of every database, as text: what a reader of the browser's files sees. Binary values are read as characters. */
const dump = () =>
  page.evaluate(async () => {
    const infos = await indexedDB.databases()
    const names = infos.map(info => info.name)
    let text = ''
    for (const info of infos) {
      if (info.name === '__dbnames') continue
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(info.name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      for (const store of Array.from(database.objectStoreNames)) {
        const rows = await new Promise(resolve => {
          const request = database.transaction(store).objectStore(store).getAll()
          request.onsuccess = () => resolve(request.result)
        })
        text += JSON.stringify(rows, (_key, value) => (value instanceof Uint8Array ? Array.from(value, c => String.fromCharCode(c)).join('') : value)).slice(0, 4_000_000)
      }
      database.close()
    }
    return { names, text }
  })

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /get started/i }).click()
  await page.getByRole('textbox').fill('Tester')
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByRole('button', { name: /see an example/i }).click()
  await page.waitForSelector('text=Tester', { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    location.hash = '#/me'
  })
  await page.waitForTimeout(800)

  // names of the example people, to look for afterwards
  const names = await page.evaluate(async () => {
    const database = await new Promise(resolve => {
      const request = indexedDB.open('aster')
      request.onsuccess = () => resolve(request.result)
    })
    const rows = await new Promise(resolve => {
      const request = database.transaction('people').objectStore('people').getAll()
      request.onsuccess = () => resolve(request.result)
    })
    database.close()
    return rows.map(person => person.firstName).filter(name => name && name.length > 3)
  })
  assert.ok(names.length >= 5, `the example data should give people to look for (got ${names.length})`)
  const readable = text => names.filter(name => text.includes(name)).length

  const before = await dump()
  assert.ok(readable(before.text) >= names.length - 1, 'without protection the names are readable on disk (the test would prove nothing otherwise)')
  step(`before: ${readable(before.text)} of ${names.length} names are readable in IndexedDB`)

  await page.getByText('Protect this device').first().click()
  await page.getByRole('button', { name: 'Set it up' }).click()
  const fields = page.locator('input[type=password]')
  await fields.nth(0).fill(PASSWORD)
  await fields.nth(1).fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForSelector('[data-testid=recovery-key]')
  const recovery = (await page.locator('[data-testid=recovery-key]').innerText()).trim()
  assert.match(recovery, /^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/, 'a recovery key is shown')
  await page.getByRole('checkbox').check()
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), page.getByRole('button', { name: 'Turn protection on' }).click()])
  await page.waitForSelector('text=Aster is locked')
  step('protection on: the app opens locked')

  const locked = await dump()
  assert.equal(readable(locked.text), 0, 'nothing readable in IndexedDB while locked')
  assert.ok(!locked.names.includes('aster'), 'the plain database is gone')
  step(`locked: 0 of ${names.length} readable, databases: ${JSON.stringify(locked.names)}`)

  await page.locator('input[type=password]').fill('not-the-password')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForSelector('[role=alert]')
  step('a wrong password is refused')

  await page.locator('input[type=password]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForSelector('text=Network pulse', { timeout: 60_000 })
  const open = await dump()
  assert.equal(readable(open.text), 0, 'nothing readable on disk even while unlocked')
  assert.ok(!open.names.includes('aster'), 'no plain database while unlocked')
  step('unlocked with the password: still nothing readable on disk')

  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('text=Aster is locked')
  await page.getByText('I forgot the password').click()
  await page.locator('input[type=password]').fill(recovery)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForSelector('text=Network pulse', { timeout: 60_000 })
  step('the recovery key opens it too')

  const violations = await page.evaluate(() => window.__violations ?? [])
  assert.deepEqual(violations, [], 'no content-policy or Trusted Types violations')
  assert.deepEqual(problems, [], 'no console errors or uncaught exceptions')
  console.log('OK')
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  if (problems.length) console.error(problems.join('\n'))
  process.exitCode = 1
} finally {
  await browser.close()
}
