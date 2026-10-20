import { describe, expect, it } from 'vitest'
import { friendlyCloudError, hasStoredSession, parseAuthHash, validEmail } from '@/cloud/auth'
import { statusLine, syncedAgo } from '@/cloud/status'

describe('parseAuthHash: links from emails', () => {
  it('password reset: tokens and type', () => {
    expect(parseAuthHash('#access_token=AAA&refresh_token=BBB&expires_in=3600&token_type=bearer&type=recovery')).toEqual({
      type: 'recovery', accessToken: 'AAA', refreshToken: 'BBB', error: undefined,
    })
  })
  it('email confirmation', () => {
    expect(parseAuthHash('#access_token=A&refresh_token=B&type=signup')?.type).toBe('signup')
  })
  it('an error in the link (expired)', () => {
    const r = parseAuthHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    expect(r?.error).toBe('Email link is invalid or has expired')
    expect(r?.accessToken).toBeUndefined()
  })
  it('ordinary app routes are not taken for a link', () => {
    for (const h of ['', '#', '#/', '#/people', '#/person/abc?access=1', '#/me']) expect(parseAuthHash(h)).toBeNull()
  })
  it('an unknown type does not break parsing', () => {
    expect(parseAuthHash('#access_token=A&type=whatever')?.type).toBe('unknown')
  })
})

describe('friendlyCloudError', () => {
  it.each([
    ['Invalid login credentials', 'Неверная почта или пароль'],
    ['Email not confirmed', 'Почта ещё не подтверждена — открой письмо и нажми ссылку'],
    ['User already registered', 'Эта почта уже зарегистрирована — войди'],
    ['Password should be at least 6 characters', 'Пароль должен быть не короче 8 символов'],
    ['email rate limit exceeded', 'Слишком много попыток — подожди минуту и повтори'],
    ['Failed to fetch', 'Нет связи с интернетом'],
    ['JWT expired', 'Сессия устарела — войди заново'],
    ['New password should be different from the old password.', 'Новый пароль должен отличаться от старого'],
  ])('%s → %s', (raw, human) => {
    expect(friendlyCloudError(new Error(raw))).toBe(human)
    expect(friendlyCloudError({ message: raw })).toBe(human)
  })
  it('an unknown error is trimmed and not empty', () => {
    expect(friendlyCloudError(new Error('x'.repeat(500))).length).toBeLessThanOrEqual(141)
    expect(friendlyCloudError('')).toBe('Что-то пошло не так')
  })
})

describe('validEmail', () => {
  it('accepts ordinary addresses and trims spaces', () => {
    expect(validEmail(' a@b.io ')).toBe(true)
    expect(validEmail('имя@почта.рф')).toBe(true)
  })
  it('rejects garbage', () => {
    for (const s of ['', 'a', 'a@b', 'a b@c.io', '@c.io', 'a@.io']) expect(validEmail(s)).toBe(false)
  })
})

describe('hasStoredSession', () => {
  it('looks in localStorage without loading the library', () => {
    localStorage.removeItem('aster-auth')
    expect(hasStoredSession()).toBe(false)
    localStorage.setItem('aster-auth', '{}')
    expect(hasStoredSession()).toBe(true)
    localStorage.removeItem('aster-auth')
  })
})

describe('statusLine', () => {
  const base = { pending: 0 }
  it('all states', () => {
    expect(statusLine({ ...base, phase: 'off' })).toEqual({ text: 'Не подключено', tone: 'warn' })
    expect(statusLine({ ...base, phase: 'idle', lastSyncAt: undefined }).tone).toBe('ok')
    expect(statusLine({ pending: 3, phase: 'syncing' }).text).toMatch(/3 изменения/)
    expect(statusLine({ pending: 1, phase: 'offline' }).text).toMatch(/1 изменение ждут/)
    expect(statusLine({ ...base, phase: 'offline' }).text).toMatch(/сохранено на устройстве/)
    expect(statusLine({ ...base, phase: 'error', error: 'Сломалось' })).toEqual({ text: 'Сломалось', tone: 'bad' })
  })
})

describe('syncedAgo', () => {
  const now = 1_800_000_000_000
  it('just now, minutes, then a date', () => {
    expect(syncedAgo(now - 10_000, now)).toBe('только что')
    expect(syncedAgo(now - 90_000, now)).toBe('2 мин назад')
    expect(syncedAgo(now - 30 * 60_000, now)).toBe('30 мин назад')
    expect(syncedAgo(now - 5 * 3600_000, now)).toMatch(/сегодня|вчера|назад/)
    expect(syncedAgo(now + 5_000, now)).toBe('только что')
  })
})
