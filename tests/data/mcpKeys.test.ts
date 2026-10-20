import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/cloud/auth', () => ({ getClient: async () => ({ rpc }) }))

import { createKey, listKeys, mcpUrl, revokeKey } from '@/mcp/keys'

describe('ключи доступа для Claude', () => {
  beforeEach(() => rpc.mockReset())

  it('адрес подключения содержит ключ', () => {
    expect(mcpUrl('abc')).toMatch(/\/functions\/v1\/mcp\/abc$/)
  })

  it('создаёт ключ и возвращает готовый адрес', async () => {
    rpc.mockResolvedValue({ data: { id: 'k1', token: 'f'.repeat(64) }, error: null })
    const k = await createKey('Ноутбук')
    expect(rpc).toHaveBeenCalledWith('mcp_create_token', { p_label: 'Ноутбук' })
    expect(k.id).toBe('k1')
    expect(k.url.endsWith(`/mcp/${'f'.repeat(64)}`)).toBe(true)
  })

  it('понятные ошибки: пять ключей, нет входа, нет сети', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'too many active keys (max 5)', code: '54000' } })
    await expect(createKey('x')).rejects.toThrow('Уже пять ключей')
    rpc.mockResolvedValue({ data: null, error: { message: 'not authenticated', code: '28000' } })
    await expect(listKeys()).rejects.toThrow('войди в облако')
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch' } })
    await expect(revokeKey('k1')).rejects.toThrow('Нет связи')
  })

  it('список и отзыв', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'k1', label: 'Claude', created_at: '2026-10-12T00:00:00Z', last_used_at: null }], error: null })
    expect(await listKeys()).toHaveLength(1)
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await revokeKey('k1')
    expect(rpc).toHaveBeenLastCalledWith('mcp_revoke_token', { p_id: 'k1' })
  })
})
