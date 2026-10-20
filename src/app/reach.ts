import { useCallback } from 'react'
import type { Person } from '@/data/types'
import { logInteraction } from '@/data/actions'
import { openChannel, primaryChannel } from '@/lib/contact'
import { useUI } from './store'
import { t } from '@/i18n'

/** "Write": opens the best channel and offers to mark the contact with one tap. */
export function useReachOut() {
  const toast = useUI(s => s.toast)
  const open = useUI(s => s.open)
  return useCallback((p: Person) => {
    const ch = primaryChannel(p)
    if (!ch) {
      open({ kind: 'log', personIds: [p.id], type: 'message' })
      return
    }
    openChannel(ch)
    setTimeout(() => {
      toast(t('{firstName}: mark as contacted?', { firstName: p.firstName }), 'info', {
        label: t('Mark'),
        run: async () => {
          await logInteraction({ personIds: [p.id], type: ch.type === 'phone' ? 'call' : 'message', date: Date.now() })
          toast(t('Contact logged'))
        },
      })
    }, 400)
  }, [toast, open])
}

export function useQuickLog() {
  const toast = useUI(s => s.toast)
  return useCallback(async (p: Person) => {
    await logInteraction({ personIds: [p.id], type: 'message', date: Date.now() })
    toast(t('{firstName}: contact logged', { firstName: p.firstName }))
  }, [toast])
}
