// Proves, in a real Chromium, how a new version reaches someone who has the app open:
// it is fetched and told about, it is NOT swapped in under their hands, and it takes over when they say so.
//
//   node scripts/e2e-update.mjs        (builds the app twice, as two named versions, and serves them from here)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { chromium } from '@playwright/test'
import { fallbackChromiumPath } from './chromium.ts'

const work = mkdtempSync(join(tmpdir(), 'update-e2e-'))
const dirs = { one: join(work, 'one'), two: join(work, 'two') }
for (const [tag, dir] of Object.entries(dirs)) {
  const built = spawnSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { env: { ...process.env, BUILD_TAG: tag }, stdio: 'inherit' })
  assert.equal(built.status, 0, `the build "${tag}" failed`)
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
let root = dirs.one
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  let file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname))
  try {
    if (!file.startsWith(root) || !statSync(file).isFile()) throw new Error('missing')
  } catch {
    file = join(root, 'index.html')
  }
  response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  response.setHeader('Cache-Control', 'no-cache')
  response.end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://localhost:${server.address().port}/`

const executablePath = fallbackChromiumPath()
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })
const step = (text) => console.log(`• ${text}`)
const build = (page) => page.evaluate(() => document.querySelector('meta[name=build]')?.getAttribute('content'))

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForTimeout(2000)
  assert.equal(await build(page), 'one')
  await page.reload({ waitUntil: 'networkidle' }); // now the service worker controls the page
  assert.equal(await build(page), 'one')
  step('version one is installed and open')

  // someone is in the middle of something
  await page.getByRole('button', { name: /get started/i }).click()
  await page.getByRole('textbox').fill('Half-written')
  await page.evaluate(() => { window.__alive = true; })

  // version two is deployed; the app asks for it (it does so when it comes to the front, and every hour)
  root = dirs.two
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); })
  await page.getByText('A new version is ready').waitFor()
  step('the person is told that a new version is ready')
  assert.equal(await page.evaluate(() => window.__alive === true), true, 'the page was not reloaded by itself')
  assert.equal(await page.getByRole('textbox').inputValue(), 'Half-written', 'what was being typed is still there')
  assert.equal(await build(page), 'one', 'the old version is still the one running')
  step('nothing was swapped under their hands: the half-written name is still there')

  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update' }).click()])
  await page.waitForFunction(() => document.querySelector('meta[name=build]')?.getAttribute('content') === 'two')
  step('on their word, the app reloaded into version two')
  console.log('OK')
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
