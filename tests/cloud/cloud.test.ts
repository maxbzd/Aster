import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/data/db'
import { resetDb } from '../helpers'

/** A fake Supabase client: enough to test our sign-in, sign-out and queue logic. */
const fake = vi.hoisted(() => {
  const state = {
    session: null as null | { user: { id: string; email: string } },
    authCb: null as null | ((event: string, session: unknown) => void),
    signInError: null as null | { message: string },
    signUpResult: { data: { user: { identities: [{}] }, session: null as unknown }, error: null as null | { message: string } },
    rpcCalls: [] as Array<{ fn: string; args: unknown }>,
    rpcError: null as null | { message: string },
    pushError: null as null | { message: string },
    signOutCalls: 0,
  }
  const client = {
    auth: {
      signInWithPassword: vi.fn(async (_c: { email: string; password: string }) => {
        if (state.signInError) return { data: { session: null }, error: state.signInError }
        state.session = { user: { id: 'u1', email: 'max@mail.com' } }
        return { data: { session: state.session }, error: null }
      }),
      signUp: vi.fn(async () => state.signUpResult),
      signOut: vi.fn(async () => { state.signOutCalls++; state.session = null; return { error: null } }),
      getSession: vi.fn(async () => ({ data: { session: state.session } })),
      setSession: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => { state.authCb = cb; return { data: { subscription: { unsubscribe() {} } } } }),
    },
    rpc: vi.fn(async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args })
      if (fn === 'sync_push' && state.pushError) return { data: null, error: state.pushError }
      if (state.rpcError && fn !== 'sync_push') return { data: null, error: state.rpcError }
      return { data: fn === 'sync_push' ? { applied: 0, stale: 0 } : null, error: null }
    }),
    from: () => ({ select: () => ({ gt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel: async () => 'ok',
  }
  return { state, client }
})

vi.mock('@/cloud/auth', async orig => ({ ...(await orig<typeof import('@/cloud/auth')>()), getClient: async () => fake.client }))

import * as cloud from '@/cloud/cloud'
import { useCloud } from '@/cloud/store'

const flush = () => new Promise(r => setTimeout(r, 30))

beforeEach(async () => {
  fake.state.session = null
  fake.state.signInError = null
  fake.state.signUpResult = { data: { user: { identities: [{}] }, session: null }, error: null }
  fake.state.rpcCalls = []
  fake.state.rpcError = null
  fake.state.pushError = null
  fake.state.signOutCalls = 0
  vi.clearAllMocks()
  await resetDb()
  useCloud.setState({ phase: 'off', email: undefined, userId: undefined, pending: 0, error: undefined, recovery: false, expired: false, notice: undefined })
})
afterEach(async () => {
  // disconnect the controller and reset the "device"
  fake.state.session = null
  await cloud.signOut({ force: true }).catch(() => undefined)
})

describe('sign-in', () => {
  it('a successful sign-in starts sync and updates the state', async () => {
    await cloud.signIn('  max@mail.com ', 'secret-pass-1')
    expect(fake.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'max@mail.com', password: 'secret-pass-1' })
    await vi.waitFor(() => expect(useCloud.getState().phase).toBe('idle'))
    expect(useCloud.getState()).toMatchObject({ userId: 'u1', email: 'max@mail.com' })
    expect(await db.syncMeta.get('userId')).toMatchObject({ value: 'u1' })
  })

  it('a wrong password: a human message, the state does not change', async () => {
    fake.state.signInError = { message: 'Invalid login credentials' }
    await expect(cloud.signIn('max@mail.com', 'x')).rejects.toThrow('Неверная почта или пароль')
    expect(useCloud.getState().userId).toBeUndefined()
  })
})

describe('sign-up', () => {
  it('the email must be confirmed', async () => {
    expect(await cloud.signUp('new@mail.com', 'long-enough-pass')).toBe('confirm')
    expect(fake.client.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@mail.com', password: 'long-enough-pass' }))
  })
  it('the email is taken: Supabase answers with a user without identities, and we say so honestly', async () => {
    fake.state.signUpResult = { data: { user: { identities: [] }, session: null }, error: null }
    await expect(cloud.signUp('taken@mail.com', 'long-enough-pass')).rejects.toThrow('уже зарегистрирована')
  })
  it('a short password is rejected before calling the server', async () => {
    await expect(cloud.signUp('a@b.io', 'short')).rejects.toThrow('не короче 8')
    expect(fake.client.auth.signUp).not.toHaveBeenCalled()
  })
  it('if email confirmation is off, you are signed in at once', async () => {
    fake.state.signUpResult = { data: { user: { identities: [{}] }, session: { user: { id: 'u1', email: 'new@mail.com' } } }, error: null }
    expect(await cloud.signUp('new@mail.com', 'long-enough-pass')).toBe('signed-in')
    await vi.waitFor(() => expect(useCloud.getState().userId).toBe('u1'))
  })
})

describe('password', () => {
  it('a reset email and a password change', async () => {
    await cloud.resetPassword(' max@mail.com ')
    expect(fake.client.auth.resetPasswordForEmail).toHaveBeenCalledWith('max@mail.com', expect.objectContaining({ redirectTo: expect.any(String) }))
    useCloud.setState({ recovery: true })
    await expect(cloud.setNewPassword('short')).rejects.toThrow('не короче 8')
    await cloud.setNewPassword('new-long-password')
    expect(fake.client.auth.updateUser).toHaveBeenCalledWith({ password: 'new-long-password' })
    expect(useCloud.getState().recovery).toBe(false)
  })
})

describe('sign-out', () => {
  it('all sent: sign-out erases the data from the device and resets the state', async () => {
    await cloud.signIn('max@mail.com', 'secret-pass-1')
    await vi.waitFor(() => expect(useCloud.getState().phase).toBe('idle'))
    await db.people.add({ id: 'p1', firstName: 'Анна' } as never)
    await vi.waitFor(async () => expect(await db.outbox.count()).toBeGreaterThan(0))
    await cloud.signOut()
    expect(await db.people.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(fake.state.signOutCalls).toBeGreaterThan(0)
    expect(useCloud.getState()).toMatchObject({ phase: 'off', userId: undefined })
    // the edit reached the server before sign-out
    expect(fake.state.rpcCalls.some(c => c.fn === 'sync_push' && JSON.stringify(c.args).includes('"id":"p1"'))).toBe(true)
  })

  it('not sent: sign-out refuses and erases nothing; force erases', async () => {
    await cloud.signIn('max@mail.com', 'secret-pass-1')
    await vi.waitFor(() => expect(useCloud.getState().phase).toBe('idle'))
    fake.state.pushError = { message: 'Failed to fetch' }
    await db.people.add({ id: 'p2', firstName: 'Борис' } as never)
    await vi.waitFor(async () => expect(await db.outbox.count()).toBeGreaterThan(0))
    await expect(cloud.signOut()).rejects.toBeInstanceOf(cloud.UnsyncedError)
    expect(await db.people.count()).toBe(1)
    expect(fake.state.signOutCalls).toBe(0)
    await cloud.signOut({ force: true })
    expect(await db.people.count()).toBe(0)
  })
})

describe('account deletion', () => {
  it('calls the server function, clears the session and stamps, the data on the device stays', async () => {
    await cloud.signIn('max@mail.com', 'secret-pass-1')
    await vi.waitFor(() => expect(useCloud.getState().phase).toBe('idle'))
    await db.people.add({ id: 'keep', firstName: 'Остаётся' } as never)
    localStorage.setItem('aster-auth', '{}')
    await cloud.deleteAccount()
    expect(fake.state.rpcCalls.some(c => c.fn === 'delete_my_account')).toBe(true)
    expect(localStorage.getItem('aster-auth')).toBeNull()
    expect(await db.syncMeta.get('userId')).toBeUndefined()
    expect(await db.people.count()).toBe(1)
    expect(useCloud.getState().userId).toBeUndefined()
  })

  it('a server error does not leave the app "half signed out"', async () => {
    await cloud.signIn('max@mail.com', 'secret-pass-1')
    await vi.waitFor(() => expect(useCloud.getState().phase).toBe('idle'))
    fake.state.rpcError = { message: 'Failed to fetch' }
    await expect(cloud.deleteAccount()).rejects.toThrow('Нет связи')
    expect(await db.syncMeta.get('userId')).toBeDefined()
  })
})

describe('auth events', () => {
  it('SIGNED_OUT because of an expired session: the data is intact, we show "sign in again"', async () => {
    await cloud.signIn('max@mail.com', 'secret-pass-1')
    await vi.waitFor(() => expect(useCloud.getState().phase).toBe('idle'))
    await db.people.add({ id: 'p1', firstName: 'Анна' } as never)
    fake.state.authCb?.('SIGNED_OUT', null)
    await flush()
    expect(useCloud.getState()).toMatchObject({ phase: 'off', expired: true, userId: undefined })
    expect(await db.people.count()).toBe(1)
  })

  it('a token refresh does not restart sync', async () => {
    await cloud.signIn('max@mail.com', 'secret-pass-1')
    await vi.waitFor(() => expect(useCloud.getState().phase).toBe('idle'))
    const before = fake.state.rpcCalls.length
    fake.state.authCb?.('TOKEN_REFRESHED', { user: { id: 'u1', email: 'max@mail.com' } })
    await flush()
    expect(useCloud.getState().phase).toBe('idle')
    expect(fake.state.rpcCalls.length).toBe(before)
  })

  it('PASSWORD_RECOVERY turns on the password change mode', async () => {
    await cloud.signIn('max@mail.com', 'secret-pass-1')
    fake.state.authCb?.('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'max@mail.com' } })
    await flush()
    expect(useCloud.getState().recovery).toBe(true)
  })
})
