import { useEffect, useState } from 'react'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { PrimaryButton } from '@/components/ui'
import { canRestore, clearConflicts, conflictLog, restoreLostValue, type ConflictEntry } from '@/cloud/history'
import { db } from '@/data/db'
import { fullName } from '@/lib/format'
import { dateLong } from '@/lib/format'
import { useUI } from '@/app/store'
import { t } from '@/i18n'

const shown = (v: unknown): string => {
  const text = typeof v === 'string' ? v : JSON.stringify(v)
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}

/** Edits that lost to a newer edit of the same field on another device, kept so they can be brought back. */
export function SyncHistorySheet({ onClose }: { onClose: () => void }) {
  const toast = useUI(s => s.toast)
  const [entries, setEntries] = useState<ConflictEntry[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    const list = (await conflictLog()).slice().reverse()
    const people = await db.people.bulkGet([...new Set(list.filter(e => e.table === 'people').map(e => e.id))])
    setNames(Object.fromEntries(people.filter(Boolean).map(p => [p!.id, fullName(p!)])))
    setEntries(list)
  }
  useEffect(() => { void load() }, [])

  const key = (e: ConflictEntry) => `${e.table}:${e.id}:${e.path}:${e.at}`
  const restore = async (e: ConflictEntry) => {
    setBusy(key(e))
    try {
      const r = await restoreLostValue(e)
      toast(r === 'restored' ? t('Restored') : r === 'gone' ? t('That record no longer exists') : t("Can't be restored automatically"), r === 'restored' ? undefined : 'info')
      await load()
    } finally { setBusy(null) }
  }

  return (
    <Sheet onClose={onClose} title={t('Replaced edits')} subtitle={t('When two devices change the same thing, the newer edit wins. The other one is kept here.')} glow="rgb(127 214 255 / 0.25)" tall
      footer={entries && entries.length > 0 ? <PrimaryButton className="w-full !bg-white/10 !text-fg" onClick={async () => { await clearConflicts(); await load() }}>{t('Clear the list')}</PrimaryButton> : undefined}>
      {entries === null ? null : entries.length === 0 ? (
        <p className="px-1 pt-3 text-[14px] text-fg-3">{t('Nothing was replaced. Edits from your devices have merged cleanly.')}</p>
      ) : (
        <ul className="flex flex-col gap-2.5 pt-1">
          {entries.map(e => (
            <li key={key(e)} className="glass rounded-[20px] p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[14.5px] font-semibold">{names[e.id] ?? e.table}</span>
                <span className="shrink-0 text-[12px] text-fg-4">{dateLong(e.at)}</span>
              </div>
              <div className="micro mt-1 text-fg-3">{e.path}</div>
              <div className="mt-2 text-[13.5px] leading-snug text-fg-2"><span className="text-fg-4">{t('You had')}: </span>{shown(e.lost)}</div>
              <div className="mt-2 flex gap-2">
                {canRestore(e)
                  ? <button type="button" disabled={busy === key(e)} onClick={() => void restore(e)} className="press hit flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-[13.5px] font-semibold"><ArrowCounterClockwiseIcon size={15} />{t('Restore')}</button>
                  : <button type="button" onClick={async () => { await navigator.clipboard?.writeText(shown(e.lost)).catch(() => undefined); toast(t('Copied')) }} className="press hit rounded-full bg-white/[0.08] px-4 py-2 text-[13.5px]">{t('Copy')}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="h-4" />
    </Sheet>
  )
}
