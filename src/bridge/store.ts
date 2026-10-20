import { create } from 'zustand'
import type { CycleReport } from './cycle'
import type { Connection } from './protocol'

export interface BridgeState {
  /** вошли в облако и мост запущен */
  active: boolean
  connections: Connection[]
  phase: 'idle' | 'syncing' | 'offline' | 'error'
  lastCycleAt?: number
  /** подключение, которое другая сторона отключила */
  revoked: boolean
  error?: string
  report?: CycleReport
}

export const useBridge = create<BridgeState>(() => ({ active: false, connections: [], phase: 'idle', revoked: false }))
export const setBridge = (p: Partial<BridgeState>) => useBridge.setState(p)

