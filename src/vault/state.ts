import { create } from 'zustand'

/** Kept apart from the runtime so that the screens can read it without loading any of the crypto. */
export type VaultState = 'checking' | 'off' | 'locked' | 'unlocked'

export const useVaultState = create<{ state: VaultState; busy: boolean }>(() => ({ state: 'checking', busy: false }))
