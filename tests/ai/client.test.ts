import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'
import { AstraError, activeAi, astraJSON, astraWebText, friendlyError } from '@/ai/client'
import { DEFAULT_MODEL, MODELS, costOf, modelInfo } from '@/ai/models'
import { saveSettings } from '@/data/actions'
import { db } from '@/data/db'
import type { AiSettings } from '@/data/types'
import { resetDb } from '../helpers'

const sdk = vi.hoisted(() => {
  const parse = vi.fn()
  const create = vi.fn()
  const ctor = vi.fn()
  return { parse, create, ctor }
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    beta = { messages: { parse: sdk.parse, create: sdk.create } }
    constructor(opts: unknown) { sdk.ctor(opts) }
  },
}))

const ai = (patch: Partial<AiSettings> = {}): AiSettings => ({ mode: 'key', apiKey: 'sk-test', model: 'claude-opus-5-5', shareNotes: false, webSearch: false, consentAt: 1, ...patch })
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }
const schema = () => Promise.resolve(z.object({ ok: z.boolean() }))

beforeEach(async () => {
  await resetDb()
  sdk.parse.mockReset()
  sdk.create.mockReset()
  sdk.ctor.mockReset()
})

describe('friendlyError — понятные ошибки по-русски', () => {
  const withStatus = (status: number, message = 'x') => Object.assign(new Error(message), { status })
  it.each([
    [401, 'auth', /Ключ не подошёл/], [403, 'auth', /Ключ не подошёл/], [429, 'rate', /Слишком много запросов/],
    [404, 'auth', /Модель недоступна/], [500, 'other', /Ошибка модели \(500\)/], [529, 'other', /529/],
  ])('HTTP %i → %s', (status, kind, re) => {
    const e = friendlyError(withStatus(status))
    expect(e).toBeInstanceOf(AstraError)
    expect(e.kind).toBe(kind)
    expect(e.message).toMatch(re)
  })
  it('нет сети → работаем в базовом режиме', () => {
    expect(friendlyError(new Error('Connection error.')).kind).toBe('network')
    expect(friendlyError(new Error('fetch failed')).message).toMatch(/базовом режиме/)
    expect(friendlyError(new Error('Request timed out.')).kind).toBe('network')
  })
  it('свои ошибки проходят без изменений, неизвестные — не теряют текст', () => {
    const own = new AstraError('отказ', 'refusal')
    expect(friendlyError(own)).toBe(own)
    expect(friendlyError(new Error('что-то странное')).message).toBe('что-то странное')
    expect(friendlyError('строка').message).toBe('Неизвестная ошибка')
    expect(friendlyError(null).kind).toBe('other')
  })
})

describe('activeAi — когда облако включено', () => {
  it.each<[string, Partial<AiSettings> | null]>([
    ['нет настроек', null],
    ['режим «выкл»', { mode: 'off' }],
    ['нет согласия', { consentAt: undefined }],
    ['ключ не введён', { apiKey: '' }],
  ])('%s → null', async (_, patch) => {
    if (patch) await saveSettings({ ai: ai(patch) })
    expect(await activeAi()).toBeNull()
  })
  it('режим «сервер» без адреса — выключено, с адресом — включено', async () => {
    await saveSettings({ ai: ai({ mode: 'proxy', proxyUrl: '' }) })
    expect(await activeAi()).toBeNull()
    await saveSettings({ ai: ai({ mode: 'proxy', proxyUrl: 'https://x.app/api/claude' }) })
    expect((await activeAi())?.mode).toBe('proxy')
  })
  it('с ключом и согласием — включено', async () => {
    await saveSettings({ ai: ai() })
    expect((await activeAi())?.apiKey).toBe('sk-test')
  })
})

describe('astraJSON — запрос к модели', () => {
  const okResponse = (extra = {}) => ({ parsed_output: { ok: true }, stop_reason: 'end_turn', model: 'claude-opus-5-5', usage, ...extra })

  it('отправляет кешируемые системный промпт и контекст, строгую схему и усилие', async () => {
    sdk.parse.mockResolvedValue(okResponse())
    const r = await astraJSON(ai(), { task: 'ask', schema, system: 'СИСТЕМА', context: 'КОНТЕКСТ', content: 'вопрос', effort: 'high' })
    expect(r).toEqual({ ok: true })
    const [body] = sdk.parse.mock.calls[0]
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.system).toEqual([{ type: 'text', text: 'СИСТЕМА', cache_control: { type: 'ephemeral' } }])
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'КОНТЕКСТ', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'вопрос' },
    ])
    expect(body.output_config.effort).toBe('high')
    expect(body.output_config.format).toBeTruthy()
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(body.fallbacks).toBe('default')
  })

  it('Haiku: без effort и без fallbacks (модель их не поддерживает)', async () => {
    sdk.parse.mockResolvedValue(okResponse({ model: 'claude-haiku-4-5' }))
    await astraJSON(ai({ model: 'claude-haiku-4-5' }), { task: 't', schema, system: 's', content: 'c' })
    const [body] = sdk.parse.mock.calls[0]
    expect(body.output_config.effort).toBeUndefined()
    expect(body.betas).toBeUndefined()
    expect(body.fallbacks).toBeUndefined()
  })

  it('неизвестная модель из настроек заменяется на модель по умолчанию', async () => {
    sdk.parse.mockResolvedValue(okResponse())
    await astraJSON(ai({ model: 'claude-старая' }), { task: 't', schema, system: 's', content: 'c' })
    expect(sdk.parse.mock.calls[0][0].model).toBe(DEFAULT_MODEL)
  })

  it('учитывает расход: токены и стоимость сохраняются', async () => {
    sdk.parse.mockResolvedValue(okResponse())
    await astraJSON(ai(), { task: 'brief', schema, system: 's', content: 'c' })
    const [u] = await db.aiUsage.toArray()
    expect(u).toMatchObject({ task: 'brief', model: 'claude-opus-5-5', input: 1000, output: 200, cacheRead: 5000 })
    expect(u.cost).toBeGreaterThan(0)
    expect(u.cost).toBeCloseTo(costOf(modelInfo('claude-opus-5-5'), { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0 }), 10)
  })

  it('свой ключ: клиент создаётся с ключом, режим «сервер» — с адресом и токеном', async () => {
    sdk.parse.mockResolvedValue(okResponse())
    await astraJSON(ai({ apiKey: 'sk-A' }), { task: 't', schema, system: 's', content: 'c' })
    expect(sdk.ctor).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'sk-A', dangerouslyAllowBrowser: true }))
    await astraJSON(ai({ mode: 'proxy', proxyUrl: 'https://my.app/api/claude/', proxyToken: 'tok' }), { task: 't', schema, system: 's', content: 'c' })
    expect(sdk.ctor).toHaveBeenLastCalledWith(expect.objectContaining({ baseURL: 'https://my.app/api/claude', apiKey: 'tok' }))
  })

  it('клиент переиспользуется, пока настройки те же', async () => {
    sdk.parse.mockResolvedValue(okResponse())
    const a = ai({ apiKey: 'sk-same' })
    await astraJSON(a, { task: 't', schema, system: 's', content: 'c' })
    const calls = sdk.ctor.mock.calls.length
    await astraJSON(a, { task: 't', schema, system: 's', content: 'c' })
    expect(sdk.ctor.mock.calls.length).toBe(calls)
  })

  it('отказ модели, обрыв по длине и пустой разбор — понятные ошибки', async () => {
    sdk.parse.mockResolvedValueOnce(okResponse({ stop_reason: 'refusal' }))
    await expect(astraJSON(ai(), { task: 't', schema, system: 's', content: 'c' })).rejects.toMatchObject({ kind: 'refusal' })
    sdk.parse.mockResolvedValueOnce(okResponse({ stop_reason: 'max_tokens' }))
    await expect(astraJSON(ai(), { task: 't', schema, system: 's', content: 'c' })).rejects.toMatchObject({ kind: 'format', message: expect.stringMatching(/слишком длинным/) })
    sdk.parse.mockResolvedValueOnce(okResponse({ parsed_output: null }))
    await expect(astraJSON(ai(), { task: 't', schema, system: 's', content: 'c' })).rejects.toMatchObject({ kind: 'format' })
  })

  it('ошибка SDK превращается в понятную', async () => {
    sdk.parse.mockRejectedValue(Object.assign(new Error('bad key'), { status: 401 }))
    await expect(astraJSON(ai(), { task: 't', schema, system: 's', content: 'c' })).rejects.toMatchObject({ kind: 'auth', message: expect.stringMatching(/Ключ/) })
  })

  it('прокидывает сигнал отмены', async () => {
    sdk.parse.mockResolvedValue(okResponse())
    const ctl = new AbortController()
    await astraJSON(ai(), { task: 't', schema, system: 's', content: 'c', signal: ctl.signal })
    expect(sdk.parse.mock.calls[0][1]).toEqual({ signal: ctl.signal })
  })
})

describe('astraWebText — поиск новостей', () => {
  const textResponse = { content: [{ type: 'text', text: 'Раунд ' }, { type: 'web_search_tool_result' }, { type: 'text', text: 'закрыт' }], stop_reason: 'end_turn', model: 'claude-opus-5-5', usage }
  it('склеивает только текстовые блоки', async () => {
    sdk.create.mockResolvedValue(textResponse)
    expect(await astraWebText(ai(), 'news', 'sys', 'prompt')).toBe('Раунд закрыт')
  })
  it('версия инструмента поиска зависит от модели', async () => {
    sdk.create.mockResolvedValue(textResponse)
    await astraWebText(ai(), 'news', 's', 'p')
    expect(sdk.create.mock.calls[0][0].tools[0].type).toBe('web_search_20260209')
    await astraWebText(ai({ model: 'claude-haiku-4-5' }), 'news', 's', 'p')
    expect(sdk.create.mock.calls[1][0].tools[0].type).toBe('web_search_20250305')
  })
  it('отказ модели — пустая строка', async () => {
    sdk.create.mockResolvedValue({ ...textResponse, stop_reason: 'refusal' })
    expect(await astraWebText(ai(), 'news', 's', 'p')).toBe('')
  })
})

describe('модели и стоимость', () => {
  it('у каждой модели есть цены и описание; по умолчанию — первая', () => {
    expect(MODELS[0].id).toBe(DEFAULT_MODEL)
    for (const m of MODELS) {
      expect(m.input).toBeGreaterThan(0)
      expect(m.output).toBeGreaterThan(m.input)
      expect(m.cacheRead).toBeLessThan(m.input)
      expect(m.note).toBeTruthy()
    }
  })
  it('costOf: токены × цена за миллион', () => {
    const m = modelInfo('claude-sonnet-5-5') // $2 вход, $10 выход, $0.2 чтение кеша
    expect(costOf(m, { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(2)
    expect(costOf(m, { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(10)
    expect(costOf(m, { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(0.2)
    expect(costOf(m, { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 })).toBeCloseTo(2.5) // запись в кеш дороже на 25%
  })
  it('modelInfo неизвестной модели → по умолчанию', () => {
    expect(modelInfo('нет такой').id).toBe(DEFAULT_MODEL)
    expect(modelInfo(undefined).id).toBe(DEFAULT_MODEL)
  })
})
