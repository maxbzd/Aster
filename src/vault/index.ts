import { db } from '@/data/db'
import { createVaultRuntime } from './session'

/** Encryption at rest for the app's database (off until the person turns it on). */
export const vault = createVaultRuntime({ app: 'aster', db, journalName: 'aster-vault' })
export { useVaultState } from './state'
