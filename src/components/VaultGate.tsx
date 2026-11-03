import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { journalExists, selectNativeBackend } from '@/vault/backend'
import { useVaultState } from '@/vault/state'

const VaultLock = lazy(() => import('./VaultLock'))

/** The journal's name and the hint that says "encryption is on" (the answer is double-checked against the real databases). */
const JOURNAL = 'aster-vault'
const HINT = 'aster.vault'

/**
 * Stands in front of the whole app. With encryption off it only checks that, in a few lines, and steps aside; with it on,
 * the vault is loaded and nothing of the app (and no database) is touched until it is open.
 */
export function VaultGate({ children, onReady }: { children: ReactNode; onReady: () => void }) {
  const state = useVaultState(s => s.state)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const found = await journalExists(JOURNAL)
      const hinted = (() => { try { return localStorage.getItem(HINT) === '1' } catch { return false } })()
      if (found === false || (found === null && !hinted)) {
        selectNativeBackend()
        useVaultState.setState({ state: 'off' })
        return
      }
      await (await import('@/vault')).vault.boot()
    })()
  }, [])
  const ready = state === 'off' || state === 'unlocked'
  const announced = useRef(false)
  useEffect(() => { if (ready && !announced.current) { announced.current = true; onReady() } }, [ready, onReady])
  if (state === 'checking') return <div className="min-h-[100dvh]" />
  if (state === 'locked') return <Suspense fallback={<div className="min-h-[100dvh]" />}><VaultLock /></Suspense>
  return <>{children}</>
}
