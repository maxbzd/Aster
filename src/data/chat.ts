import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from './db'
import type { ChatMessage } from './types'

const KEEP = 200

export const useChat = (): ChatMessage[] | undefined => useLiveQuery(() => db.chat.orderBy('at').toArray(), [])

export async function addChatMessage(m: Omit<ChatMessage, 'id' | 'at'> & { at?: number }): Promise<ChatMessage> {
  const value: ChatMessage = { id: uid(), at: m.at ?? Date.now(), ...m }
  await db.chat.put(value)
  // the chat is Astra's memory on the device, not an archive: only the latest messages are kept
  const n = await db.chat.count()
  if (n > KEEP) {
    const old = await db.chat.orderBy('at').limit(n - KEEP).primaryKeys()
    await db.chat.bulkDelete(old)
  }
  return value
}

export const clearChat = () => db.chat.clear()
