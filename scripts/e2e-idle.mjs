// A phone's battery is spent by an app that keeps working while nobody touches it. In a real Chromium this opens the main screens of
// the example data, leaves them alone for five seconds each and measures how busy the main thread is. Animations that run forever
// (an orbit turning, a sphere, a canvas) show up here.
//
//   npm run build && npm run preview -- --port 4174 --strictPort     (in another terminal)
//   BASE_URL=http://localhost:4174/ npm run e2e:idle
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { fallbackChromiumPath } from './chromium.ts';

const BASE = (process.env.BASE_URL ?? 'http://localhost:4174/').replace(/#.*$/, '');
const BUDGET_PERCENT = Number(process.env.IDLE_BUSY_PERCENT ?? 10); // a slow CI machine is allowed several times what a laptop needs
const ROUTES = ['/', '/people', '/orbit', '/graph', '/year'];

const executablePath = fallbackChromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /get started/i }).click();
  await page.getByRole('textbox').fill('Tester');
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByRole('button', { name: /see an example/i }).click();
  await page.waitForTimeout(4000);

  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  for (const route of ROUTES) {
    await page.evaluate((hash) => { location.hash = `#${hash}`; }, route);
    await page.waitForTimeout(2500); // let the screen settle
    const before = await metrics();
    await page.waitForTimeout(5000);
    const after = await metrics();
    results.push({ route, busyPercent: Number((((after.TaskDuration - before.TaskDuration) / 5) * 100).toFixed(1)), layoutsPerSecond: Number(((after.LayoutCount - before.LayoutCount) / 5).toFixed(1)) });
  }
} finally {
  await browser.close();
}

console.table(results);
const bad = results.filter((r) => r.busyPercent > BUDGET_PERCENT);
assert.equal(bad.length, 0, `busy while idle (over ${BUDGET_PERCENT} % of the main thread): ${bad.map((r) => `${r.route} ${r.busyPercent} %`).join('; ')}`);
console.log(`OK — no screen uses more than ${BUDGET_PERCENT} % of the main thread while left alone`);
