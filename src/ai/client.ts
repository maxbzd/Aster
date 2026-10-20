// The SDK is loaded lazily, only when Astra really goes to the cloud
import type Anthropic from '@anthropic-ai/sdk'
import type * as z from 'zod/v4'
import { db, uid } from '@/data/db'
import type { AiSettings } from '@/data/types'
import { costOf, modelInfo, providerOf } from './models'
import { authedFetch, serverBase } from './managed'
import { t } from '@/i18n'

export class AstraError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'rate' | 'network' | 'refusal' | 'format' | 'other' = 'other') {
    super(message)
  }
}

let cached: { key: string; client: Anthropic } | null = null

async function clientFor(ai: AiSettings) {
  const key = `${ai.mode}|${ai.apiKey ?? ''}|${ai.proxyUrl ?? ''}|${ai.proxyToken ?? ''}`
  if (cached?.key === key) return cached.client
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // A personal app with no server: the user's key is stored only on their device.
  // Proxy mode keeps the key on the server, and here there is only the access token for the proxy.
  const client =
    ai.mode === 'managed'
      // the key is on the server: the SDK calls the function and fetch signs the request with the account session
      ? new Anthropic({ baseURL: `${serverBase()}/anthropic`, apiKey: 'server', dangerouslyAllowBrowser: true, maxRetries: 2, fetch: authedFetch })
      : ai.mode === 'proxy'
      ? new Anthropic({ baseURL: ai.proxyUrl!.replace(/\/$/, ''), apiKey: ai.proxyToken || 'proxy', dangerouslyAllowBrowser: true, maxRetries: 2 })
      : new Anthropic({ apiKey: ai.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 })
  cached = { key, client }
  return client
}

/** Whether Astra is connected to a cloud model. */
export async function activeAi(): Promise<AiSettings | null> {
  const ai = (await db.settings.get('me'))?.ai
  if (!ai || ai.mode === 'off' || !ai.consentAt) return null
  if (ai.mode === 'key' && !ai.apiKey) return null
  if (ai.mode === 'proxy' && !ai.proxyUrl) return null
  return ai
}

export function friendlyError(e: unknown): AstraError {
  if (e instanceof AstraError) return e
  // without instanceof, so as not to pull the SDK into the main bundle
  const value = e instanceof Error ? e.message : ''
  const status = (e as { status?: number } | null)?.status
  if (e instanceof Error && e.name === 'Error' && (e as { kind?: string }).kind === 'format') return new AstraError(e.message, 'format')
  if (status === 401 || status === 403) return new AstraError(t("The key was rejected — check Astra's settings. In server mode you need to sign in and your email must be on the owners list"), 'auth')
  if (status === 429) return new AstraError(t('Too many requests — try again in a minute'), 'rate')
  if (!status && /connection|timed out|fetch|network/i.test(value)) return new AstraError(t('No connection to the model — working in basic mode'), 'network')
  if (status === 404) return new AstraError(t("The model isn't available for this key — choose another"), 'auth')
  if (status) return new AstraError(t('Model error ({status})', { status }), 'other')
  return new AstraError(e instanceof Error ? e.message : t('Unknown error'), 'other')
}

async function recordUsage(task: string, model: string, usage: Anthropic.Beta.BetaUsage | undefined) {
  if (!usage) return
  const u = {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  }
  await db.aiUsage.put({ id: uid(), at: Date.now(), task, model, ...u, cost: costOf(modelInfo(model), u) })
}

export interface JsonCall<T extends z.ZodType> {
  task: string
  /** schemas (zod) are loaded only when the cloud is called */
  schema: () => Promise<T>
  /** a stable system prompt: cached */
  system: string
  /** a large stable context (the network index): a separate cacheable block */
  context?: string
  content: string | Anthropic.Beta.BetaContentBlockParam[]
  effort?: 'low' | 'medium' | 'high'
  maxTokens?: number
  signal?: AbortSignal
}

/** A model call with a strict JSON schema for the answer. */
export async function astraJSON<T extends z.ZodType>(ai: AiSettings, call: JsonCall<T>): Promise<z.infer<T>> {
  const m = modelInfo(ai.model)
  // Gemini, Groq and gateways: a different request format (OpenAI), they work only through the server mode
  if (ai.mode === 'managed' && providerOf(ai.model) !== 'anthropic') {
    try {
      const { compatJSON } = await import('./compat')
      return await compatJSON(ai, { ...call, content: call.content as never })
    } catch (e) {
      throw friendlyError(e)
    }
  }
  const body: Anthropic.Beta.BetaContentBlockParam[] = typeof call.content === 'string' ? [{ type: 'text', text: call.content }] : call.content
  const content: Anthropic.Beta.BetaContentBlockParam[] = call.context
    ? [{ type: 'text', text: call.context, cache_control: { type: 'ephemeral' } }, ...body]
    : body
  try {
    const client = await clientFor(ai)
    const [{ betaZodOutputFormat }, schema] = await Promise.all([import('@anthropic-ai/sdk/helpers/beta/zod'), call.schema()])
    const res = await client.beta.messages.parse(
      {
        model: m.id,
        max_tokens: call.maxTokens ?? 12000,
        system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
        output_config: { format: betaZodOutputFormat(schema), ...(m.effort ? { effort: call.effort ?? 'medium' } : {}) },
        ...(m.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: call.signal },
    )
    await recordUsage(call.task, res.model ?? m.id, res.usage)
    if (res.stop_reason === 'refusal') throw new AstraError(t('The model refused to answer this request'), 'refusal')
    if (res.stop_reason === 'max_tokens') throw new AstraError(t('The reply was too long — try something shorter'), 'format')
    if (!res.parsed_output) throw new AstraError(t("Couldn't parse the model's reply"), 'format')
    return res.parsed_output as z.infer<T>
  } catch (e) {
    throw friendlyError(e)
  }
}

/** A free-text answer with web search (reasons: news about a person/company). */
export async function astraWebText(ai: AiSettings, task: string, system: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const m = modelInfo(ai.model)
  // web search exists only for Claude; with the free models news-based reasons are simply not looked up
  if (providerOf(ai.model) !== 'anthropic') return ''
  try {
    const client = await clientFor(ai)
    const res = await client.beta.messages.create(
      {
        model: m.id,
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: prompt }],
        // older models (Haiku 4.5) use the base version of the tool
        tools: [m.id.includes('haiku') ? { type: 'web_search_20250305', name: 'web_search', max_uses: 3 } : { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
        ...(m.effort ? { output_config: { effort: 'low' as const } } : {}),
        ...(m.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    )
    await recordUsage(task, res.model ?? m.id, res.usage)
    if (res.stop_reason === 'refusal') return ''
    return res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('').trim()
  } catch (e) {
    throw friendlyError(e)
  }
}
