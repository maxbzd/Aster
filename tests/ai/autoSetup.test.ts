import { describe, expect, it } from 'vitest'
import { serverSetup } from '@/ai/autoSetup'
import type { ServerStatus } from '@/ai/managed'

const st = (o: Partial<ServerStatus> = {}): ServerStatus => ({ allowed: true, anthropic: false, gemini: false, groq: false, gateway: false, gatewayModels: [], stt: false, ...o })

describe('auto-setup from server keys', () => {
  it('without access it turns nothing on', () => {
    expect(serverSetup(st({ allowed: false, gateway: true, gatewayModels: ['vendor/model-a'], stt: true }))).toEqual({})
    expect(serverSetup(null)).toEqual({})
  })

  it('turns on the owner\'s first gateway model and server speech', () => {
    expect(serverSetup(st({ gateway: true, gatewayModels: ['vendor/model-a', 'vendor/model-b'], gemini: true, stt: true }))).toEqual({
      ai: { mode: 'managed', model: 'gw:vendor/model-a' },
      stt: { provider: 'managed' },
    })
  })

  it('without a gateway: free Gemini, then Groq', () => {
    expect(serverSetup(st({ gemini: true, groq: true }))?.ai?.model).toBe('gemini-2.5-flash')
    expect(serverSetup(st({ groq: true }))?.ai?.model).toBe('openai/gpt-oss-120b')
  })

  it('does not override a choice already made', () => {
    const own = { ai: { mode: 'key' as const, model: 'claude-opus-5-5', apiKey: 'sk-test', shareNotes: true, webSearch: false }, stt: { provider: 'openai' as const, language: 'ru' } }
    expect(serverSetup(st({ gateway: true, gatewayModels: ['vendor/model-a'], stt: true }), own)).toEqual({})
  })

  it('no keys on the server: nothing to change', () => {
    expect(serverSetup(st())).toEqual({})
  })
})
