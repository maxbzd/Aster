import { create } from 'zustand'
import type { CycleReport } from './cycle'
import type { Connection } from './protocol'

export interface BridgeState {
  /** signed in to the cloud and the bridge is running */
  active: boolean
  connections: Connection[]
  phase: 'idle' | 'syncing' | 'offline' | 'error'
  lastCycleAt?: number
  /** a connection that the other side disconnected */
  revoked: boolean
  error?: string
  report?: CycleReport
}

export const useBridge = create<BridgeState>(() => ({ active: false, connections: [], phase: 'idle', revoked: false }))
export const setBridge = (p: Partial<BridgeState>) => useBridge.setState(p)

