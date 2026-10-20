import { useMemo, useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { Chip, PrimaryButton, Segmented } from '@/components/ui'
import { parseVCards } from '@/data/vcard'
import { db } from '@/data/db'
import { useCircles, usePeople } from '@/data/hooks'
import { CLOSENESS } from '@/data/logic'
import { PALETTES } from '@/lib/colors'
import { fullName } from '@/lib/format'
import { useUI } from '@/app/store'
import type { Closeness } from '@/data/types'
import { t, tn } from '@/i18n'

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export function ImportSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const parsed = useMemo(() => parseVCards(text), [text])
  const people = usePeople(true)
  const circles = useCircles()
  const toast = useUI(s => s.toast)
  const [circleIds, setCircleIds] = useState<string[]>([])
  const [closeness, setCloseness] = useState<Closeness>(4)
  const [busy, setBusy] = useState(false)

  const fresh = useMemo(() => {
    const existing = new Set((people ?? []).map(p => norm(fullName(p))))
    const seen = new Set<string>()
    return parsed.filter(p => {
      const k = norm(fullName(p))
      if (existing.has(k) || seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [parsed, people])

  const run = async () => {
    setBusy(true)
    await db.people.bulkPut(fresh.map(p => ({ ...p, circleIds, closeness })))
    toast(t('Imported: {pl}', { pl: tn(fresh.length, '{n} contact', '{n} contacts') }))
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={t('Import contacts')} tall
      subtitle={parsed.length ? t('Found {pl}{v}', { pl: tn(parsed.length, '{n} contact', '{n} contacts'), v: parsed.length !== fresh.length ? t(', new — {count}', { count: fresh.length }) : '' }) : t('No contacts in the file')}
      footer={<PrimaryButton className="w-full" disabled={!fresh.length || busy} onClick={run}>{busy ? t('Importing…') : t('Add {count}', { count: fresh.length })}</PrimaryButton>}>
      {fresh.length > 0 && (
        <>
          <div className="mt-1 flex flex-wrap gap-2">
            {fresh.slice(0, 14).map(p => (
              <div key={p.id} className="flex w-[64px] flex-col items-center gap-1.5">
                <Avatar person={p} size={48} />
                <span className="w-full truncate text-center text-[11.5px] text-fg-3">{p.firstName}</span>
              </div>
            ))}
            {fresh.length > 14 && <div className="grid h-12 w-12 place-items-center rounded-full bg-white/[0.06] text-[13px] text-fg-2">+{fresh.length - 14}</div>}
          </div>
          <div className="micro mb-2 mt-7 px-1 text-fg-3">{t('Orbit for everyone')}</div>
          <Segmented<Closeness> value={closeness} onChange={setCloseness} options={([1, 2, 3, 4] as Closeness[]).map(c => ({ value: c, label: CLOSENESS[c].short }))} />
          <p className="mt-2 px-1 text-[12.5px] text-fg-4">{t('Imported people are usually “acquaintances”. You can move close ones to a nearer orbit later in their profile.')}</p>
          {circles.length > 0 && (
            <>
              <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Circle (optional)')}</div>
              <div className="flex flex-wrap gap-1.5">
                {circles.map(c => (
                  <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={circleIds.includes(c.id)}
                    onClick={() => setCircleIds(ids => (ids.includes(c.id) ? ids.filter(x => x !== c.id) : [...ids, c.id]))}>{c.emoji} {c.name}</Chip>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <div className="h-4" />
    </Sheet>
  )
}
