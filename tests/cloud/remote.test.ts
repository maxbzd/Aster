import { describe, expect, it } from 'vitest'
import { PermanentRemoteError } from '@/cloud/engine'
import { supabaseRemote } from '@/cloud/remote'

const clientWith = (error: unknown) => ({ rpc: async () => ({ data: null, error }) }) as never

describe('supabaseRemote: какие ошибки считаются «насовсем»', () => {
  it.each([['23514'], ['23505'], ['22P02'], ['42501'], ['PGRST102']])('код %s — отклонение сервера', async code => {
    await expect(supabaseRemote(clientWith({ code, message: 'x' })).push([])).rejects.toBeInstanceOf(PermanentRemoteError)
  })
  it.each([[{ code: '', message: 'Failed to fetch' }], [{ code: '57014', message: 'timeout' }], [{ code: 'PGRST301', message: 'JWT expired' }]])('сбой %j повторяется', async err => {
    const e = await supabaseRemote(clientWith(err)).push([]).catch(x => x)
    expect(e).not.toBeInstanceOf(PermanentRemoteError)
  })
  it('успех возвращает счётчики', async () => {
    const c = { rpc: async () => ({ data: { applied: 2, stale: 1 }, error: null }) } as never
    expect(await supabaseRemote(c).push([])).toEqual({ applied: 2, stale: 1 })
  })
})
