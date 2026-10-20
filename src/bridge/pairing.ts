import { BridgeError } from './protocol'
import { t } from '@/i18n'

/** What is encoded in the pairing code: where the source app lives and a one-time code. */
export interface PairingPayload {
  /** the address of the Supabase project */
  u: string
  /** the project's public key (publishable/anon) */
  k: string
  /** a one-time code */
  c: string
  /** the name of the app that created the code */
  l: string
}

const PREFIX = 'bridge1.'

const toB64Url = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromB64Url = (s: string) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)))
}

export const encodePairing = (p: PairingPayload) => PREFIX + toB64Url(JSON.stringify(p))

/** Parses a pasted code. Extra spaces, line breaks and quotes around it are tolerated. */
export function decodePairing(text: string): PairingPayload {
  const raw = text.trim().replace(/^["'«]+|["'»]+$/g, '').replace(/\s+/g, '')
  if (!raw.startsWith(PREFIX)) throw new BridgeError('bad-code', t("This isn't a connection code. Copy it whole from the other app."))
  let p: Partial<PairingPayload>
  try {
    p = JSON.parse(fromB64Url(raw.slice(PREFIX.length))) as Partial<PairingPayload>
  } catch {
    throw new BridgeError('bad-code', t('The code is corrupted. Copy it again in full.'))
  }
  const okUrl = typeof p.u === 'string' && /^https:\/\/[^\s/]+(\/)?$/.test(p.u)
  const okCode = typeof p.c === 'string' && /^bo_[0-9a-f]{48}$/.test(p.c)
  if (!okUrl || !okCode || typeof p.k !== 'string' || !p.k || p.k.length > 400) {
    throw new BridgeError('bad-code', t('The code is corrupted. Copy it again in full.'))
  }
  return { u: p.u!.replace(/\/$/, ''), k: p.k, c: p.c!, l: typeof p.l === 'string' ? p.l.slice(0, 60) : '' }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

/** A new access key: 256 bits of randomness. */
export function newToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return `bt_${hex(b)}`
}

/** The same hash the server computes (bridge_hash): SHA-256 in hex. */
export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return hex(new Uint8Array(d))
}
