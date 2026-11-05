// A big network must stay usable. In a real Chromium this loads the example data, multiplies it to SIZE people, notes and reminders
// (the copies share the same few roles and cities on purpose: that is the worst case for the introductions matchmaker), then opens
// the heavy screens one by one and fails when one of them holds the page for too long or the memory grows too far.
// It found a real one: with 3,000 people the Today screen froze for 29 seconds and used 1.4 GB.
//
//   npm run build && npm run preview -- --port 4174 --strictPort     (in another terminal)
//   BASE_URL=http://localhost:4174/ npm run e2e:scale
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { fallbackChromiumPath } from './chromium.ts';

const BASE = (process.env.BASE_URL ?? 'http://localhost:4174/').replace(/#.*$/, '');
const SIZE = Number(process.env.SIZE ?? 2000);
// generous: a CI machine is slower than a laptop, and a long task is not yet a freeze
const BUDGET = { longestTaskMs: Number(process.env.LONGEST_TASK_MS ?? 2500), heapMB: Number(process.env.HEAP_MB ?? 500) };
const ROUTES = ['/', '/people', '/reserve', '/pulse', '/year', '/graph', '/orbit'];

const executablePath = fallbackChromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /get started/i }).click();
  await page.getByRole('textbox').fill('Tester');
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByRole('button', { name: /see an example/i }).click();
  await page.waitForTimeout(2500);

  const sizes = await page.evaluate(async ({ SIZE }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('aster'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out = {};
    for (const store of ['people', 'interactions', 'reminders', 'leads']) {
      const rows = await new Promise((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
      const keyPath = db.transaction(store).objectStore(store).keyPath;
      const add = [];
      for (let i = 0; rows.length + add.length < SIZE; i++) {
        const copy = structuredClone(rows[i % rows.length]);
        copy[keyPath] = crypto.randomUUID();
        if (copy.firstName) copy.firstName = `${copy.firstName} ${i}`;
        add.push(copy);
      }
      await new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); add.forEach((r) => tx.objectStore(store).put(r)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      out[store] = rows.length + add.length;
    }
    db.close();
    return out;
  }, { SIZE });
  console.log(`• ${sizes.people} people, ${sizes.interactions} entries, ${sizes.reminders} reminders`);
  assert.ok(sizes.people >= SIZE, 'the data was multiplied');

  for (const route of ROUTES) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    const m = await page.evaluate(async (to) => {
      const longs = [];
      const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(e.duration)));
      po.observe({ type: 'longtask' });
      const t0 = performance.now();
      let last = t0;
      const mo = new MutationObserver(() => { last = performance.now(); });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true });
      location.hash = `#${to}`;
      // settled: nothing has changed on the page for 400 ms
      await new Promise((res) => { const tick = () => (performance.now() - last > 400 && performance.now() - t0 > 500 ? res() : setTimeout(tick, 50)); tick(); });
      mo.disconnect(); po.disconnect();
      return { longestTask: Math.round(Math.max(0, ...longs)), nodes: document.querySelectorAll('*').length };
    }, route);
    const heap = (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'JSHeapUsedSize').value;
    results.push({ route, ...m, heapMB: Math.round(heap / 1048576) });
  }
} finally {
  await browser.close();
}

console.table(results);
const bad = results.filter((r) => r.longestTask > BUDGET.longestTaskMs || r.heapMB > BUDGET.heapMB);
assert.equal(bad.length, 0, `over budget (${BUDGET.longestTaskMs} ms for one task, ${BUDGET.heapMB} MB of memory): ${bad.map((r) => `${r.route} ${r.longestTask} ms ${r.heapMB} MB`).join('; ')}`);
console.log(`OK — with ${SIZE} people no screen holds the page longer than ${BUDGET.longestTaskMs} ms`);
