import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCloud } from '@/cloud/store'

const inner = vi.hoisted(() => ({ bootCloud: vi.fn(async () => undefined) }))
vi.mock('@/cloud/cloud', () => inner)

import { bootCloud } from '@/cloud/boot'

beforeEach(() => {
  inner.bootCloud.mockClear()
  localStorage.removeItem('aster-auth')
  window.location.hash = '#/'
  useCloud.setState({ phase: 'off' })
})

describe('bootCloud', () => {
  it('with no session and no link nothing heavy is loaded', async () => {
    await bootCloud()
    expect(inner.bootCloud).not.toHaveBeenCalled()
    expect(useCloud.getState().phase).toBe('off')
  })
  it('a saved session: starts the cloud', async () => {
    localStorage.setItem('aster-auth', '{"x":1}')
    await bootCloud()
    expect(inner.bootCloud).toHaveBeenCalledTimes(1)
  })
  it('arrived through a link from an email: starts it too', async () => {
    window.location.hash = '#access_token=a&refresh_token=b&type=recovery'
    await bootCloud()
    expect(inner.bootCloud).toHaveBeenCalledTimes(1)
  })
  it('if the cloud code did not load (no network), the app stays working', async () => {
    localStorage.setItem('aster-auth', '{"x":1}')
    inner.bootCloud.mockRejectedValueOnce(new Error('chunk failed'))
    await expect(bootCloud()).resolves.toBeUndefined()
    expect(useCloud.getState().phase).toBe('offline')
  })
})
