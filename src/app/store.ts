import { create } from 'zustand'
import type { ID, InteractionType } from '@/data/types'
import type { Occasion } from '@/ai/local/occasions'

export type SheetState =
  | { kind: 'addPerson' }
  | { kind: 'editPerson'; id: ID }
  | { kind: 'log'; personIds?: ID[]; type?: InteractionType; interactionId?: ID }
  | { kind: 'family'; ownerId: ID; id?: ID }
  | { kind: 'dateEdit'; personId: ID; id?: ID }
  | { kind: 'prefs'; personId: ID }
  | { kind: 'status'; personId: ID }
  | { kind: 'collectionEdit'; id?: ID; addPersonIds?: ID[] }
  | { kind: 'collectionPick'; personIds: ID[] }
  | { kind: 'bulk'; personIds: ID[] }
  | { kind: 'dedupe' }
  | { kind: 'reminder'; personId?: ID; text?: string }
  | { kind: 'circles' }
  | { kind: 'importVcf'; text: string }
  | { kind: 'brief'; personId: ID }
  | { kind: 'draft'; personId: ID; occasion?: Occasion | null }
  | { kind: 'intro'; aId: ID; bId: ID; reason: string; value: string }
  | { kind: 'astra' }
  | { kind: 'cloud' }
  | { kind: 'bridge' }
  | { kind: 'ticktick' }
  | { kind: 'claude' }
  | { kind: 'backup' }
  | { kind: 'vault' }
  | { kind: 'syncHistory' }
  | { kind: 'cloudKey' }
  | { kind: 'restore'; mode: 'replace' | 'merge'; file: unknown }
  | { kind: 'lead'; id: ID }
  | { kind: 'leadEdit'; id?: ID; smart?: string; keep?: { source?: string; tags?: string[] } }
  | { kind: 'leadImport'; file?: File; text?: string }
  | null

export interface ToastAction { label: string; run: () => void }
interface Toast { id: number; text: string; icon?: 'check' | 'info' | 'bell'; action?: ToastAction }

interface UI {
  sheet: SheetState
  open: (s: Exclude<SheetState, null>) => void
  close: () => void
  search: boolean
  setSearch: (v: boolean) => void
  toasts: Toast[]
  toast: (text: string, icon?: Toast['icon'], action?: ToastAction, keep?: boolean) => void
  dismissToast: (id: number) => void
}

let tid = 0
export const useUI = create<UI>(set => ({
  sheet: null,
  open: sheet => set({ sheet }),
  close: () => set({ sheet: null }),
  search: false,
  setSearch: search => set({ search }),
  toasts: [],
  toast: (text, icon = 'check', action, keep = false) => {
    const id = ++tid
    set(s => ({ toasts: [...s.toasts.slice(-2), { id, text, icon, action }] }))
    // `keep`: stays until it is answered or closed (a new version is ready: the person picks the moment)
    if (!keep) setTimeout(() => set(s => ({ toasts: s.toasts.filter(toast2 => toast2.id !== id) })), action ? 6000 : 2600)
  },
  dismissToast: id => set(s => ({ toasts: s.toasts.filter(toast3 => toast3.id !== id) })),
}))

export const haptic = (ms = 8) => { try { navigator.vibrate?.(ms) } catch { /* noop */ } }
