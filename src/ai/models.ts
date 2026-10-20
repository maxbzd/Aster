import { t } from '@/i18n'

export type ModelProvider = 'anthropic' | 'gemini' | 'groq' | 'gateway'

export interface ModelInfo {
  id: string
  /** Who serves the model: Claude can be called directly; the others only through the server mode. */
  provider?: ModelProvider
  name: string
  note: string
  /** $ per 1M tokens */
  input: number
  output: number
  cacheRead: number
  /** supports server-side fallbacks ("default") */
  fallbacks: boolean
  /** supports output_config.effort */
  effort: boolean
}

export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', get note() { return t('Best understanding of people and context') }, input: 4, output: 20, cacheRead: 0.2, fallbacks: true, effort: true },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', get note() { return t('Faster and half the price') }, input: 2, output: 10, cacheRead: 0.2, fallbacks: true, effort: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', get note() { return t('Fastest and most economical') }, input: 1, output: 5, cacheRead: 0.1, fallbacks: false, effort: false },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', get note() { return t('Maximum intelligence, the most expensive') }, input: 10, output: 50, cacheRead: 0.25, fallbacks: true, effort: true },
]

/** Free Gemini and Groq models (their data may be used for training). They work only in the server mode. */
export const SERVER_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-flash', provider: 'gemini', name: 'Gemini 2.5 Flash', get note() { return t('Free · best language support among the free ones') }, input: 0, output: 0, cacheRead: 0, fallbacks: false, effort: false },
  { id: 'gemini-2.5-flash-lite', provider: 'gemini', name: 'Gemini 2.5 Flash-Lite', get note() { return t('Free · faster and simpler') }, input: 0, output: 0, cacheRead: 0, fallbacks: false, effort: false },
  { id: 'openai/gpt-oss-120b', provider: 'groq', name: 'GPT-OSS 120B (Groq)', get note() { return t('Free · very fast') }, input: 0, output: 0, cacheRead: 0, fallbacks: false, effort: false },
  { id: 'llama-3.3-70b-versatile', provider: 'groq', name: 'Llama 3.3 70B (Groq)', get note() { return t('Free · fallback') }, input: 0, output: 0, cacheRead: 0, fallbacks: false, effort: false },
]

/**
 * Models of an OpenAI-compatible gateway the server owner configured (GATEWAY_MODELS). They are stored with a prefix
 * so that the app can tell which provider to call without asking the server first.
 */
export const GATEWAY_PREFIX = 'gw:'
export const gatewayModel = (id: string): ModelInfo => ({
  id: GATEWAY_PREFIX + id, provider: 'gateway', name: id, get note() { return t('Via your gateway · priced by its plan') }, input: 0, output: 0, cacheRead: 0, fallbacks: false, effort: false,
})
/** The id to send to the API (without the app's prefix). */
export const apiModelId = (id: string) => (id.startsWith(GATEWAY_PREFIX) ? id.slice(GATEWAY_PREFIX.length) : id)

export const DEFAULT_MODEL = 'claude-opus-5-5'
export const modelInfo = (id?: string): ModelInfo =>
  MODELS.find(m => m.id === id) ?? SERVER_MODELS.find(m => m.id === id) ?? (id?.startsWith(GATEWAY_PREFIX) ? gatewayModel(id.slice(GATEWAY_PREFIX.length)) : MODELS[0]!)

/** Human-friendly model name for lists and reports. */
export const modelLabel = (id: string) => MODELS.find(m => m.id === id)?.name ?? SERVER_MODELS.find(m => m.id === id)?.name ?? apiModelId(id)

export const providerOf = (id?: string): ModelProvider => modelInfo(id).provider ?? 'anthropic'

export function costOf(m: ModelInfo, u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  return (u.input * m.input + u.cacheWrite * m.input * 1.25 + u.cacheRead * m.cacheRead + u.output * m.output) / 1_000_000
}
