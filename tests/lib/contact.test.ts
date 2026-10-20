import { afterEach, describe, expect, it, vi } from 'vitest'
import { openChannel, phoneOf, primaryChannel } from '@/lib/contact'
import { person } from '../helpers'

const ch = (type: string, value: string) => ({ type, value }) as never

describe('primaryChannel', () => {
  it('picks a messenger before a phone and an email', () => {
    const p = person({ channels: [ch('email', 'a@b.io'), ch('phone', '+7900'), ch('telegram', 'alina')] })
    expect(primaryChannel(p)?.type).toBe('telegram')
  })
  it('skips empty values', () => {
    const p = person({ channels: [ch('telegram', '  '), ch('email', 'a@b.io')] })
    expect(primaryChannel(p)?.type).toBe('email')
  })
  it('no channels: undefined', () => {
    expect(primaryChannel(person({ channels: [] }))).toBeUndefined()
  })
})

describe('phoneOf', () => {
  it('a phone or WhatsApp', () => {
    expect(phoneOf(person({ channels: [ch('whatsapp', '+7 900')] }))?.type).toBe('whatsapp')
    expect(phoneOf(person({ channels: [ch('email', 'a@b.io')] }))).toBeUndefined()
  })
})

describe('openChannel', () => {
  afterEach(() => vi.restoreAllMocks())
  it('opens web links in a new tab without an opener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    openChannel(ch('telegram', ' @alina '))
    expect(open).toHaveBeenCalledWith('https://t.me/alina', '_blank', 'noopener')
  })
  it('a site without a scheme gets https', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    openChannel(ch('website', 'acme.io'))
    expect(open).toHaveBeenCalledWith('https://acme.io', '_blank', 'noopener')
  })
})
