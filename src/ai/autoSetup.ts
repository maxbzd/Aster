import type { AiSettings, Settings, SttSettings } from '@/data/types'
import { DEFAULT_MODEL, GATEWAY_PREFIX } from './models'
import type { ServerStatus } from './managed'
import { serverHasAi } from './managed'

export const AI_DEFAULTS: AiSettings = { mode: 'off', model: DEFAULT_MODEL, shareNotes: true, webSearch: false }

/**
 * What to switch on by itself once, after signing in, it turns out the server has keys.
 * Anything chosen by hand is left alone: the model is enabled while Astra works "on the device", speech while it is not set up.
 */
export function serverSetup(status: ServerStatus | null, settings?: Pick<Settings, 'ai' | 'stt'>): { ai?: Partial<AiSettings>; stt?: Partial<SttSettings> } {
  if (!status?.allowed) return {}
  const out: { ai?: Partial<AiSettings>; stt?: Partial<SttSettings> } = {}
  if (serverHasAi(status) && (!settings?.ai || settings.ai.mode === 'off')) {
    // the owner's own gateway first (they chose the models), then the free ones, then Claude
    const model = status.gateway && status.gatewayModels[0] ? GATEWAY_PREFIX + status.gatewayModels[0] : status.gemini ? 'gemini-2.5-flash' : status.groq ? 'openai/gpt-oss-120b' : DEFAULT_MODEL
    out.ai = { mode: 'managed', model }
  }
  if (status.stt && (!settings?.stt || settings.stt.provider === 'off')) out.stt = { provider: 'managed' }
  return out
}
