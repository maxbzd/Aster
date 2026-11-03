import { create } from 'zustand'

export type CloudPhase =
  | 'off' // not signed in to the cloud
  | 'starting' // restoring the session
  | 'idle' // everything is synced
  | 'syncing'
  | 'offline'
  | 'error'

export interface CloudState {
  phase: CloudPhase
  email?: string
  userId?: string
  lastSyncAt?: number
  /** how many changes are not sent yet */
  pending: number
  /** how many records the server rejected (too large or malformed) */
  rejected: number
  error?: string
  /** the person arrived through a "reset password" link and must set a new one */
  recovery: boolean
  /** the session ended on its own: sign in again */
  expired: boolean
  /** cloud encryption: this device seals what it sends ('on'), the cloud copy is sealed and this device lacks the key ('locked'), or neither ('off') */
  e2e?: 'off' | 'on' | 'locked'
  /** a one-off message (for example, "another account's data was removed from this device") */
  notice?: string
}

export const useCloud = create<CloudState>(() => ({ phase: 'off', pending: 0, rejected: 0, recovery: false, expired: false }))
export const setCloud = (patch: Partial<CloudState>) => useCloud.setState(patch)
