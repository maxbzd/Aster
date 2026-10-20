import * as z from 'zod/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compatJSON, extractJson, toParts } from '@/ai/compat'
import { astraJSON, astraWebText } from '@/ai/client'
import { providerOf, modelInfo } from '@/ai/models'
import { db } from '@/data/db'
import type { AiSettings } from '@/data/types'
import { resetDb } from '../helpers'

const ai = (model = 'gemini-2.5-flash'): AiSettings => ({ mode: 'managed', model, shareNotes: true, webSearch: true, consentAt: 1 })
const Schema = z.object({ answer: z.string(), n: z.number() })
const call = (extra: object = {}) => ({ task: 't', schema: async () => Schema, system: 'Системный промпт', content: 'Вопрос', ...extra })

const reply = (content: string, extra: object = {}) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30 }, ...extra }), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(async () => { await resetDb() })
afterEach(() => vi.unstubAllGlobals())

describe('JSON from the model\'s answer', () => {
  it('plain JSON, in ```json```, with an explanation around it', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Вот ответ: {"a":1}. Надеюсь, помог!')).toEqual({ a: 1 })
    expect(() => extractJson('нет объекта')).toThrow()
  })

  it('images in the Anthropic format become image_url', () => {
    expect(toParts('текст')).toBe('текст')
    expect(toParts([{ type: 'image', source: { media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'описание' }])).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'text', text: 'описание' },
    ])
  })
})

describe('calling a free model through the server', () => {
  it('the request goes to its provider\'s route, the schema is in the prompt, the answer is validated and the usage is recorded at zero cost', async () => {
    const f = vi.fn(async () => reply('{"answer":"ок","n":2}'))
    vi.stubGlobal('fetch', f)
    const out = await compatJSON(ai(), call({ context: 'КОНТЕКСТ СЕТИ' }))
    expect(out).toEqual({ answer: 'ок', n: 2 })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/functions\/v1\/ai\/gemini\/chat\/completions$/)
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gemini-2.5-flash')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('Системный промпт')
    expect(body.messages[0].content).toContain('КОНТЕКСТ СЕТИ')
    expect(body.messages[0].content).toContain('"answer"')
    const usage = await db.aiUsage.toArray()
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ model: 'gemini-2.5-flash', input: 120, output: 30, cost: 0 })
  })

  it('the owner\'s gateway model: route /gateway, the app\'s prefix does not get into the request', async () => {
    const f = vi.fn(async () => reply('{"answer":"ок","n":1}'))
    vi.stubGlobal('fetch', f)
    await compatJSON(ai('gw:vendor/model-a'), call())
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/functions\/v1\/ai\/gateway\/chat\/completions$/)
    expect(JSON.parse(init.body as string).model).toBe('vendor/model-a')
    expect(providerOf('gw:vendor/model-a')).toBe('gateway')
    expect(modelInfo('gw:vendor/model-a')).toMatchObject({ name: 'vendor/model-a', input: 0, output: 0 })
  })

  it('Groq goes to its own route', async () => {
    const f = vi.fn(async () => reply('{"answer":"ок","n":1}'))
    vi.stubGlobal('fetch', f)
    await compatJSON(ai('openai/gpt-oss-120b'), call())
    expect((f.mock.calls[0] as unknown as [string])[0]).toMatch(/\/groq\/chat\/completions$/)
  })

  it('a malformed answer: one chance to fix it, then a clear error', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply('{"answer":5}')).mockResolvedValueOnce(reply('```json\n{"answer":"ок","n":1}\n```'))
    vi.stubGlobal('fetch', f)
    expect(await compatJSON(ai(), call())).toEqual({ answer: 'ок', n: 1 })
    const second = JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
    expect(second.messages.at(-1).content).toMatch(/не подошёл/)

    vi.stubGlobal('fetch', vi.fn(async () => reply('совсем не json')))
    await expect(compatJSON(ai(), call())).rejects.toThrow(/Не удалось разобрать/)
  })

  it('server errors: sign-in, limit, a cut-off answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(compatJSON(ai(), call())).rejects.toMatchObject({ status: 401 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    await expect(compatJSON(ai(), call())).rejects.toMatchObject({ status: 429 })
    vi.stubGlobal('fetch', vi.fn(async () => reply('{"answer":"x","n":1', { choices: [{ message: { content: '{"answer":"x"' }, finish_reason: 'length' }] })))
    await expect(compatJSON(ai(), call())).rejects.toThrow(/слишком длинным/)
  })
})

describe('choosing the path in the client', () => {
  it('a Gemini model in server mode goes through the OpenAI format, not through the Anthropic SDK', async () => {
    const f = vi.fn(async () => reply('{"answer":"ок","n":3}'))
    vi.stubGlobal('fetch', f)
    expect(await astraJSON(ai(), call())).toEqual({ answer: 'ок', n: 3 })
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain('/gemini/chat/completions')
  })

  it('web search is disabled for free models: an empty answer with no requests', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await astraWebText(ai(), 'news', 's', 'p')).toBe('')
    expect(f).not.toHaveBeenCalled()
  })

  it('the catalogue: the provider is determined by the model; an unknown model is Claude', () => {
    expect(providerOf('gemini-2.5-flash')).toBe('gemini')
    expect(providerOf('openai/gpt-oss-120b')).toBe('groq')
    expect(providerOf('claude-opus-5-5')).toBe('anthropic')
    expect(providerOf('что-то')).toBe('anthropic')
    expect(modelInfo('gemini-2.5-flash').input).toBe(0)
  })
})
