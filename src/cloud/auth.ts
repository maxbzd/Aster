import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './config'
import { t, msg } from '@/i18n'

let clientPromise: Promise<SupabaseClient> | null = null

/** The Supabase library is heavy, so it is loaded lazily, only when the cloud is really needed. */
export function getClient(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // links from emails are parsed by us (parseAuthHash): the app uses a HashRouter and # is taken by the routes
        detectSessionInUrl: false,
        flowType: 'implicit',
        storageKey: 'aster-auth',
      },
    }),
  )
  return clientPromise
}

/** Whether there is a saved session; checked without loading the library. */
export function hasStoredSession(): boolean {
  try { return !!localStorage.getItem('aster-auth') } catch { return false }
}

export const MIN_PASSWORD = 8

const MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, msg('Wrong email or password')],
  [/email not confirmed/i, msg("Email isn't confirmed yet — open the email and click the link")],
  [/user already registered|already been registered/i, msg('This email is already registered — sign in')],
  [/password should be at least|weak password|password is too short/i, msg('The password must be at least {MIN_PASSWORD} characters')],
  [/same password|different from the old/i, msg('The new password must differ from the old one')],
  [/rate limit|too many|over_email_send_rate_limit|security purposes/i, msg('Too many attempts — wait a minute and try again')],
  [/unable to validate email|invalid email|valid email/i, msg('Check the email address')],
  [/signups? not allowed|signup is disabled/i, msg('Sign-ups are currently disabled')],
  [/failed to fetch|network|load failed|fetch/i, msg('No internet connection')],
  [/jwt expired|invalid jwt|refresh token/i, msg('Session expired — sign in again')],
]

/** An error message about sign-in and sync that a person can understand. */
export function friendlyCloudError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  for (const [re, item] of MESSAGES) if (re.test(raw)) return t(item, { MIN_PASSWORD })
  return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw || t('Something went wrong')
}

export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())

export interface AuthHash { type: 'recovery' | 'signup' | 'magiclink' | 'invite' | 'email_change' | 'unknown'; accessToken?: string; refreshToken?: string; error?: string }

/** Parses #access_token=…&type=recovery from a link in an email. Ordinary routes (#/people) are left alone. */
export function parseAuthHash(hash: string): AuthHash | null {
  const h = hash.replace(/^#\/?/, '')
  if (!/(^|&)(access_token|error_description|error_code)=/.test(h)) return null
  const p = new URLSearchParams(h)
  const value = p.get('type')
  const type = (['recovery', 'signup', 'magiclink', 'invite', 'email_change'] as const).find(x => x === value) ?? 'unknown'
  return {
    type,
    accessToken: p.get('access_token') ?? undefined,
    refreshToken: p.get('refresh_token') ?? undefined,
    error: p.get('error_description')?.replace(/\+/g, ' ') ?? undefined,
  }
}

export type { Session }
