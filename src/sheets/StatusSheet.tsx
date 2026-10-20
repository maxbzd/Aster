import { useEffect, useState } from 'react'
import { CheckCircleIcon, CircleDashedIcon, HandPalmIcon, PauseCircleIcon, type Icon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { PrimaryButton } from '@/components/ui'
import { db } from '@/data/db'
import { patchPerson } from '@/data/actions'
import { useUI } from '@/app/store'
import type { LifeStatus } from '@/data/types'
import { t } from '@/i18n'

export const STATUS_META: Record<LifeStatus, { label: string; short: string; hint: string; color: string; icon: Icon }> = {
  lost_touch: { get label() { return t('Lost touch') }, get short() { return t('Lost touch') }, get hint() { return t('Life took you apart. If you want, you can return to this person — the card and all history stay.') }, color: '#8fb8ff', icon: CircleDashedIcon },
  paused: { get label() { return t('Deliberately not in touch') }, get short() { return t('Paused') }, get hint() { return t('This is a choice — yours or mutual. No reminders until you bring them back.') }, color: '#ffb36b', icon: PauseCircleIcon },
  irrelevant: { get label() { return t('No longer relevant') }, get short() { return t('Not relevant') }, get hint() { return t("The contact has run its course. They quietly leave your network pulse, reasons to reach out and birthdays, but aren't deleted.") }, color: '#9b9cb4', icon: HandPalmIcon },
}

/** A relationship status without deleting the person: the reminders go away, not the memory of them. */
export function StatusSheet({ personId, onClose }: { personId: string; onClose: () => void }) {
  const toast = useUI(s => s.toast)
  const [status, setStatus] = useState<LifeStatus | null>(null)
  const [note, setNote] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    void db.people.get(personId).then(p => { if (!p) return; setName(p.firstName); setStatus(p.lifeStatus ?? null); setNote(p.lifeStatusNote ?? '') })
  }, [personId])

  const save = async () => {
    await patchPerson(personId, status
      ? { lifeStatus: status, lifeStatusNote: note.trim() || undefined, lifeStatusAt: Date.now() }
      : { lifeStatus: undefined, lifeStatusNote: undefined, lifeStatusAt: undefined })
    toast(status ? t('{label}: no reminders', { label: STATUS_META[status].label }) : t('Back to normal network life'), 'info')
    onClose()
  }

  return (
    <Sheet onClose={onClose} glow="rgb(143 184 255 / 0.28)" title={t('Relationship status')} subtitle={name || undefined}
      footer={<PrimaryButton className="w-full" onClick={save}>{t('Save')}</PrimaryButton>}>
      <div className="flex flex-col gap-2.5 pt-1">
        <Option on={status === null} onClick={() => setStatus(null)} icon={CheckCircleIcon} color="#5fe3b0" label={t('Normal network life')} hint={t('Rhythm, reminders and reasons to reach out work as usual.')} />
        {(Object.keys(STATUS_META) as LifeStatus[]).map(s => <Option key={s} on={status === s} onClick={() => setStatus(s)} icon={STATUS_META[s].icon} color={STATUS_META[s].color} label={STATUS_META[s].label} hint={STATUS_META[s].hint} />)}
      </div>
      {status && (
        <div className="mt-4">
          <div className="micro mb-2 px-1 text-fg-3">{t('Note to self')}</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={t("What happened — so you don't have to guess later")}
            className="w-full resize-none rounded-[18px] border border-line bg-white/[0.04] p-3.5 text-[15px] leading-relaxed outline-none placeholder:text-fg-4" />
        </div>
      )}
      <div className="h-4" />
    </Sheet>
  )
}

function Option({ on, onClick, icon: I, color, label, hint }: { on: boolean; onClick: () => void; icon: Icon; color: string; label: string; hint: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`press flex items-start gap-3.5 rounded-[22px] border px-4 py-3.5 text-left transition-colors ${on ? 'border-white/30 bg-white/[0.08]' : 'border-line bg-white/[0.03]'}`}>
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}><I size={20} weight="duotone" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15.5px] font-semibold">{label}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-fg-3">{hint}</span>
      </span>
      <span className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${on ? 'border-fg bg-fg text-ink' : 'border-white/25'}`}>{on && '✓'}</span>
    </button>
  )
}
