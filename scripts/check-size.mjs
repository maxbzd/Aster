// Download size budget: fails if the startup JS has grown. Run: npm run build && npm run size
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const DIST = 'dist'
// The headroom was raised on purpose: the core holds the i18n runtime, bilingual name handling, lists, duplicates and family dates;
// heavy screens (profile, graph, year recap, chat, voice) are lazy-loaded.
const BUDGET = { entryKb: 135, initialKb: 340 } // gzip, KB

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const refs = [...html.matchAll(/(?:src|href)="\/?([^"]+\.js)"/g)].map(m => m[1])
const initial = [...new Set(refs)]
if (!initial.length) {
  console.error('No script found in dist/index.html: run npm run build first')
  process.exit(1)
}

const kb = file => gzipSync(readFileSync(join(DIST, file))).length / 1024
const sizes = initial.map(f => ({ f, kb: kb(f), entry: /assets\/index-/.test(f) }))
const total = sizes.reduce((s, x) => s + x.kb, 0)
const entry = Math.max(...sizes.filter(x => x.entry).map(x => x.kb), 0)

for (const x of sizes.sort((a, b) => b.kb - a.kb)) console.log(`${x.kb.toFixed(1).padStart(7)} KB  ${x.f}`)
console.log(`\nstartup download: ${total.toFixed(1)} KB gzip (budget ${BUDGET.initialKb}); main chunk: ${entry.toFixed(1)} KB (budget ${BUDGET.entryKb})`)

if (total > BUDGET.initialKb || entry > BUDGET.entryKb) {
  console.error('Size budget exceeded. Move the heavy part into a lazy chunk, or raise the budget on purpose.')
  process.exit(1)
}
