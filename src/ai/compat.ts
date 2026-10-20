import type * as z from 'zod/v4'
import { db, uid } from '@/data/db'
import type { AiSettings } from '@/data/types'
import { authedFetch, serverBase } from './managed'
import { apiModelId, providerOf, type ModelProvider } from './models'
import { t } from '@/i18n'

/**
 * Models other than Anthropic's (Gemini, Groq, your gateway) speak the OpenAI format. They have no strict response schema like Claude,
 * so the schema goes into the prompt, we ask for one JSON object and validate the reply with zod; on failure the model gets one chance to fix it.
 */

export interface CompatCall<T extends z.ZodType> {
  task: string
  schema: () => Promise<T>
  system: string
  context?: string
  /** text or blocks in the Anthropic format (text / image): images are converted to the OpenAI format */
  content: string | Array<{ type: string; text?: string; source?: { media_type?: string; data?: string } }>
  maxTokens?: number
  signal?: AbortSignal
}

export class CompatError extends Error {
  constructor(message: string, readonly status?: number, readonly kind: 'auth' | 'rate' | 'format' | 'other' = 'other') { super(message) }
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export function toParts(content: CompatCall<z.ZodType>['content']): string | Part[] {
  if (typeof content === 'string') return content
  const parts: Part[] = []
  for (const b of content) {
    if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text })
    else if (b.type === 'image' && b.source?.data) parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type ?? 'image/jpeg'};base64,${b.source.data}` } })
  }
  return parts
}

/** Pulls the JSON out of a reply: models like to wrap it in ```json …``` or add an explanation. */
export function extractJson(text: string): unknown {
  const query = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(query)
  const candidate = fenced ? fenced[1]!.trim() : query
  try { return JSON.parse(candidate) } catch { /* ищем объект внутри текста */ }
  const a = candidate.indexOf('{')
  const b = candidate.lastIndexOf('}')
  if (a >= 0 && b > a) return JSON.parse(candidate.slice(a, b + 1))
  throw new SyntaxError(t('no JSON'))
}

export interface CompatReply { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } }

async function post(provider: ModelProvider, body: object, signal?: AbortSignal): Promise<CompatReply> {
  const res = await authedFetch(`${serverBase()}/${provider}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  if (res.status === 401) throw new CompatError(t('Sign-in required'), 401, 'auth')
  if (res.status === 403) throw new CompatError(t('Server keys are not available to this account'), 403, 'auth')
  if (res.status === 429) throw new CompatError(t('Too many requests — try again in a minute'), 429, 'rate')
  const data = (await res.json().catch(() => null)) as CompatReply | null
  if (!res.ok) throw new CompatError(data?.error?.message ?? t('Model error ({status})', { status: res.status }), res.status)
  return data ?? {}
}

/**
 * Gateways and models treat parameters differently: "thinking" models have no temperature or max_tokens (they need max_completion_tokens),
 * and json_object is not everywhere. On a refusal (400) the next set is tried and the one that worked is remembered.
 */
const VARIANTS: Array<(n: number) => object> = [
  n => ({ max_tokens: n, temperature: 0.3, response_format: { type: 'json_object' } }),
  n => ({ max_completion_tokens: n, response_format: { type: 'json_object' } }),
  n => ({ max_tokens: n }),
  n => ({ max_completion_tokens: n }),
]
const working = new Map<string, number>()

export async function compatChat(provider: ModelProvider, model: string, messages: object[], maxTokens: number, signal?: AbortSignal): Promise<CompatReply> {
  for (let i = working.get(model) ?? 0; i < VARIANTS.length; i++) {
    try {
      const reply = await post(provider, { model: apiModelId(model), messages, ...VARIANTS[i]!(maxTokens) }, signal)
      working.set(model, i)
      return reply
    } catch (e) {
      if (!(e instanceof CompatError && e.status === 400 && i < VARIANTS.length - 1)) throw e
    }
  }
  throw new CompatError(t("Couldn't reach the model"))
}

export async function compatJSON<T extends z.ZodType>(ai: AiSettings, call: CompatCall<T>): Promise<z.infer<T>> {
  const provider = providerOf(ai.model)
  const [schema, { toJSONSchema }] = await Promise.all([call.schema(), import('zod/v4')])
  const system = t('{system}\n\nAnswer with ONLY a single JSON object, no explanations and no markdown, strictly following this JSON schema:\n{stringify}{v}', { system: call.system, stringify: JSON.stringify(toJSONSchema(schema)), v: call.context ? `\n\n${call.context}` : '' })
  const messages: Array<{ role: string; content: string | Part[] }> = [{ role: 'system', content: system }, { role: 'user', content: toParts(call.content) }]
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await compatChat(provider, ai.model, messages, call.maxTokens ?? 12000, call.signal)
    const u = reply.usage
    // free models cost 0, but token usage is still recorded — you can see how much goes
    if (u) await db.aiUsage.put({ id: uid(), at: Date.now(), task: call.task, model: ai.model, input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0, cost: 0 })
    const choice = reply.choices?.[0]
    const text = choice?.message?.content ?? ''
    if (choice?.finish_reason === 'length') throw new CompatError(t('The reply was too long — try something shorter'), undefined, 'format')
    try {
      const parsed = schema.safeParse(extractJson(text))
      if (parsed.success) return parsed.data as z.infer<T>
      lastError = parsed.error.issues.slice(0, 4).map(i => `${i.path.join('.') || t('root')}: ${i.message}`).join('; ')
    } catch { lastError = t('the reply is not JSON') }
    messages.push({ role: 'assistant', content: text || '{}' }, { role: 'user', content: t("The reply didn't fit ({lastError}). Return a corrected JSON object matching the schema, with no explanations.", { lastError }) })
  }
  throw new CompatError(t("Couldn't parse the model's reply"), undefined, 'format')
}
