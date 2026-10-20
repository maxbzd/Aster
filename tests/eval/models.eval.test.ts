// @vitest-environment node
/**
 * Compares AI models on Astra's tasks from the terminal. The cases live in src/ai/eval/suite.ts (the same as the /eval screen in the app).
 * The data is made up. The test skips itself until a key is set.
 *
 * Run:     npm run eval
 * Key:     a .env.eval file in the project root (it is git-ignored), e.g.
 *            EVAL_API_KEY=...
 *            EVAL_BASE_URL=https://api.openai.com/v1      (any OpenAI-compatible endpoint)
 *            EVAL_MODELS=gpt-4o,gpt-4o-mini               (comma-separated)
 * Report:  eval-output/<time>.md
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildReport, CASES, grounded, runSuite, summarize, type ChatFn } from '@/ai/eval/suite'

const KEY = process.env.EVAL_API_KEY ?? ''
const BASE = (process.env.EVAL_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
const MODELS = (process.env.EVAL_MODELS ?? 'gpt-4o-mini').split(',').map(s => s.trim()).filter(Boolean)

/** Gateways treat parameters differently: on a refusal (400) the next set is tried. */
const chat: ChatFn = async (model, messages) => {
  const variants: object[] = [
    { max_tokens: 6000, response_format: { type: 'json_object' } },
    { max_completion_tokens: 6000, response_format: { type: 'json_object' } },
    { max_tokens: 6000 },
    { max_completion_tokens: 6000 },
  ]
  let last = ''
  for (const v of variants) {
    const res = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model, messages, ...v }), signal: AbortSignal.timeout(170_000) })
    const raw = await res.text()
    if (res.ok) {
      const j = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      return { text: j.choices?.[0]?.message?.content ?? '', inTok: j.usage?.prompt_tokens ?? 0, outTok: j.usage?.completion_tokens ?? 0 }
    }
    last = `${res.status} ${raw.slice(0, 300).replaceAll(KEY, '***')}`
    if ([401, 402, 403, 429].includes(res.status)) break
  }
  throw new Error(last)
}

describe.skipIf(!KEY)('model comparison on the assistant tasks', () => {
  it('runs every case on every model and writes a report', async () => {
    const rows = await runSuite(MODELS, chat, r => console.log(`${r.issues.length === 0 && !r.call.error ? 'OK ' : 'XX '} ${r.model.padEnd(22)} ${r.c.id}${r.call.error ? '  ERROR: ' + r.call.error.slice(0, 120) : ''}`))
    mkdirSync('eval-output', { recursive: true })
    const file = `eval-output/${new Date().toISOString().replace(/[:.]/g, '-')}.md`
    writeFileSync(file, buildReport(MODELS, rows, BASE))
    console.log('\nИТОГ\n' + summarize(MODELS, rows).map(t => `${t.model}: ${t.ok}/${t.total} прошло, ошибок запроса ${t.errors}, чинил JSON ${t.repaired}, ${t.sec} с, токенов ${t.inTok}/${t.outTok}`).join('\n') + `\nОтчёт: ${file}`)
    expect(rows.length).toBe(MODELS.length * CASES.length)
  }, 1_800_000)
})

describe('the check suite itself', () => {
  it('cases exist and every one has a unique id', () => {
    expect(new Set(CASES.map(c => c.id)).size).toBe(CASES.length)
    expect(CASES.length).toBeGreaterThanOrEqual(14)
  })
  it('the heuristic notices inventions', () => {
    expect(grounded('loves running', 'loves running in the mornings')).toBe(true)
    expect(grounded('plays the cello', 'loves running in the mornings')).toBe(false)
  })
  it('empty answers get issues instead of crashing', async () => {
    // a mini model that answers every case with an empty JSON object: each case must report issues or an error
    const rows = await runSuite(['x'], async () => ({ text: '{}', inTok: 1, outTok: 1 }))
    expect(rows).toHaveLength(CASES.length)
    expect(rows.every(r => r.issues.length > 0 || r.call.error)).toBe(true)
  })
})
