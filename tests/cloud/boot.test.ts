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
  it('без сессии и ссылки ничего тяжёлого не загружает', async () => {
    await bootCloud()
    expect(inner.bootCloud).not.toHaveBeenCalled()
    expect(useCloud.getState().phase).toBe('off')
  })
  it('есть сохранённая сессия — запускает облако', async () => {
    localStorage.setItem('aster-auth', '{"x":1}')
    await bootCloud()
    expect(inner.bootCloud).toHaveBeenCalledTimes(1)
  })
  it('пришли по ссылке из письма — тоже запускает', async () => {
    window.location.hash = '#access_token=a&refresh_token=b&type=recovery'
    await bootCloud()
    expect(inner.bootCloud).toHaveBeenCalledTimes(1)
  })
  it('если облачный код не загрузился (нет сети), приложение остаётся рабочим', async () => {
    localStorage.setItem('aster-auth', '{"x":1}')
    inner.bootCloud.mockRejectedValueOnce(new Error('chunk failed'))
    await expect(bootCloud()).resolves.toBeUndefined()
    expect(useCloud.getState().phase).toBe('offline')
  })
})
