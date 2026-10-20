import type { Channel, ChannelType, Person } from '@/data/types'
import { CHANNELS } from '@/components/icons'

const MESSAGE_PRIORITY: ChannelType[] = ['telegram', 'whatsapp', 'phone', 'email', 'instagram', 'linkedin', 'x', 'website', 'other']

export function primaryChannel(p: { channels: Channel[] }): Channel | undefined {
  for (const item of MESSAGE_PRIORITY) {
    const c = p.channels.find(ch => ch.type === item && ch.value.trim())
    if (c) return c
  }
}

export const phoneOf = (p: Person) => p.channels.find(c => c.type === 'phone' || c.type === 'whatsapp')

export function openChannel(c: Channel) {
  const href = CHANNELS[c.type].href(c.value.trim())
  if (href.startsWith('http')) window.open(href, '_blank', 'noopener')
  else window.location.href = href
}
