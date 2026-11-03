import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/** Runs public/tt-policy.js against a stand-in trustedTypes and returns the policy it registers. */
function install() {
  const created: Array<{ name: string; rules: { createScriptURL?: (u: string) => string; createHTML?: unknown; createScript?: unknown } }> = []
  vi.stubGlobal('trustedTypes', { createPolicy: (name: string, rules: never) => { created.push({ name, rules }); return rules } })
  new Function('window', 'location', readFileSync('public/tt-policy.js', 'utf8'))(globalThis, { href: 'https://app.example/aster/', origin: 'https://app.example' })
  vi.unstubAllGlobals()
  return created
}

describe('the Trusted Types policy', () => {
  it('registers only the default policy, with a rule for script addresses and none for HTML or script text', () => {
    const [policy, ...rest] = install()
    expect(rest).toHaveLength(0)
    expect(policy!.name).toBe('default')
    expect(typeof policy!.rules.createScriptURL).toBe('function')
    expect(policy!.rules.createHTML).toBeUndefined()
    expect(policy!.rules.createScript).toBeUndefined()
  })

  it('lets an address on the app\'s own origin through, relative or absolute', () => {
    const { rules } = install()[0]!
    expect(rules.createScriptURL!('./sw.js')).toBe('https://app.example/aster/sw.js')
    expect(rules.createScriptURL!('/aster/registerSW.js')).toBe('https://app.example/aster/registerSW.js')
    expect(rules.createScriptURL!('https://app.example/other.js')).toBe('https://app.example/other.js')
  })

  it('refuses any other origin, including look-alikes', () => {
    const { rules } = install()[0]!
    for (const bad of ['https://evil.example/x.js', 'http://app.example/x.js', 'https://app.example.evil.example/x.js', '//evil.example/x.js', 'data:text/javascript,alert(1)']) {
      expect(() => rules.createScriptURL!(bad), bad).toThrow(TypeError)
    }
  })

  it('does nothing where the browser has no Trusted Types', () => {
    vi.stubGlobal('trustedTypes', undefined)
    expect(() => new Function('window', 'location', readFileSync('public/tt-policy.js', 'utf8'))(globalThis, { href: 'https://a/', origin: 'https://a' })).not.toThrow()
    vi.unstubAllGlobals()
  })
})
