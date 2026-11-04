import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { supabaseOwn } from '@/bridge/own'
import { BridgeError } from '@/bridge/protocol'

type Reply = { data?: unknown; error?: { message: string; code?: string } | null }

/** Just enough of the Supabase client: `from(table).select()` and `rpc(name, args)` answer what the test says. */
function client(reply: Reply) {
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: reply.data ?? null, error: reply.error ?? null }))
  const select = vi.fn(async (_cols: string) => ({ data: reply.data ?? null, error: reply.error ?? null }))
  const from = vi.fn((_table: string) => ({ select }))
  return { c: { from, rpc } as unknown as SupabaseClient, rpc, from, select }
}

describe('the bridge calls in your own project', () => {
  it('reads connections and links (stamps come back as numbers)', async () => {
    const a = client({ data: [{ id: 'c1' }] })
    expect(await supabaseOwn(a.c).listConnections()).toEqual([{ id: 'c1' }])
    expect(a.from).toHaveBeenCalledWith('bridge_connections')

    const b = client({ data: [{ local_id: 'x', peer_id: 'y', origin: 'own', deleted: false, updated_ms: '1700000000000' }] })
    const links = await supabaseOwn(b.c).listLinks()
    expect(links[0]!.updated_ms).toBe(1_700_000_000_000)
    expect(b.from).toHaveBeenCalledWith('bridge_links')
  })

  it('no rows at all is an empty list, not a crash', async () => {
    expect(await supabaseOwn(client({ data: null }).c).listConnections()).toEqual([])
    expect(await supabaseOwn(client({ data: null }).c).listLinks()).toEqual([])
  })

  it('publishes items with a stamp even when the item has none', async () => {
    const a = client({})
    vi.spyOn(Date, 'now').mockReturnValue(42)
    await supabaseOwn(a.c).publish([
      { entity: 'person', key: 'k1', data: { a: 1 }, deleted: false, updated_ms: 7 },
      { entity: 'person', key: 'k2', data: {}, deleted: true },
    ] as never)
    expect(a.rpc).toHaveBeenCalledWith('bridge_publish', { p_items: [
      { entity: 'person', key: 'k1', data: { a: 1 }, deleted: false, updated_ms: 7 },
      { entity: 'person', key: 'k2', data: {}, deleted: true, updated_ms: 42 },
    ] })
  })

  it('sends links, offers, registration, completion, disconnects and scope changes to the right functions', async () => {
    const a = client({ data: { code: 'bo_1', expires_at: '2026-01-01T00:00:00Z' } })
    const own = supabaseOwn(a.c)
    await own.putLinks([])
    expect(await own.createOffer('Phone', ['people'] as never)).toEqual({ code: 'bo_1', expiresAt: '2026-01-01T00:00:00Z' })
    await own.complete('c1', { label: 'L', url: 'u', key: 'k', token: 't' })
    await own.disconnect('c1')
    await own.setScopes('c1', ['people'] as never)
    expect(a.rpc.mock.calls.map(c => c[0])).toEqual(['bridge_links_put', 'bridge_create_offer', 'bridge_complete', 'bridge_disconnect', 'bridge_set_scopes'])
    expect(a.rpc).toHaveBeenCalledWith('bridge_complete', { p_id: 'c1', p_label: 'L', p_url: 'u', p_key: 'k', p_token: 't' })

    const b = client({ data: 'conn-9' })
    expect(await supabaseOwn(b.c).register('hash', ['people'] as never)).toBe('conn-9')
  })

  it.each([
    ['Too many connections for this user', 'limit'],
    ['TypeError: Failed to fetch', 'offline'],
    ['NetworkError when attempting', 'offline'],
    ['Load failed', 'offline'],
    ['not authenticated', 'not-signed-in'],
    ['something else broke', 'server'],
  ])('the error "%s" becomes a %s error with a message a person can read', async (message, code) => {
    const own = supabaseOwn(client({ error: { message } }).c)
    const err = await own.disconnect('c1').catch(e => e)
    expect(err).toBeInstanceOf(BridgeError)
    expect((err as BridgeError).kind).toBe(code)
    if (code === 'server') expect((err as BridgeError).message).toBe(message)
  })

  it('the sign-in error code alone is enough to say "sign in first"', async () => {
    const err = await supabaseOwn(client({ error: { message: 'x', code: '28000' } }).c).listLinks().catch(e => e)
    expect((err as BridgeError).kind).toBe('not-signed-in')
  })

  it('every call reports a failure the same way', async () => {
    const own = supabaseOwn(client({ error: { message: 'Failed to fetch' } }).c)
    for (const call of [
      () => own.listConnections(), () => own.listLinks(), () => own.publish([]), () => own.putLinks([]),
      () => own.createOffer('x', []), () => own.register('h', []), () => own.complete('i', { label: '', url: '', key: '', token: '' }),
      () => own.disconnect('i'), () => own.setScopes('i', []),
    ]) await expect(call()).rejects.toMatchObject({ kind: 'offline' })
  })
})
