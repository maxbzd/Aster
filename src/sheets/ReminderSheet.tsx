import { useMemo, useState } from 'react'
import { CalendarPlusIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Chip, PrimaryButton } from '@/components/ui'
import { PersonPicker } from '@/components/forms'
import { DateTimeField } from '@/components/pickers'
import { addReminder } from '@/data/actions'
import { usePeople } from '@/data/hooks'
import { DAY, dateLong, startOfDay, timeHM } from '@/lib/format'
import { download, reminderICS } from '@/lib/ics'
import { useUI } from '@/app/store'
import type { ID } from '@/data/types'
import { t } from '@/i18n'


export function ReminderSheet({ personId, text: initialText, onClose }: { personId?: ID; text?: string; onClose: () => void }) {
  const people = usePeople()
  const toast = useUI(s => s.toast)
  const [ids, setIds] = useState<ID[]>(personId ? [personId] : [])
  const person = people?.find(p => p.id === ids[0])
  const [text, setText] = useState(initialText ?? '')
  const [cal, setCal] = useState(false)

  const presets = useMemo(() => {
    const t0 = startOfDay()
    const now = Date.now()
    const evening = t0 + 19 * 3600_000
    return [
      ...(evening > now + 30 * 60000 ? [{ label: t('This evening'), at: evening }] : []),
      { label: t('Tomorrow morning'), at: t0 + DAY + 10 * 3600_000 },
      { label: t('In 3 days'), at: t0 + 3 * DAY + 10 * 3600_000 },
      { label: t('In a week'), at: t0 + 7 * DAY + 10 * 3600_000 },
      { label: t('In a month'), at: t0 + 30 * DAY + 10 * 3600_000 },
    ]
  }, [])
  const [at, setAt] = useState(presets[0].at)

  const placeholder = person ? t('Reach out: {firstName}', { firstName: person.firstName }) : t('What to do?')
  const save = async () => {
    const query = text.trim() || placeholder
    await addReminder({ personId: ids[0], text: query, dueAt: at })
    if (cal) download(t('Reminder.ics'), reminderICS(query, at, person ? `${person.firstName} ${person.lastName ?? ''}` : undefined), 'text/calendar')
    toast(t("I'll remind you on {dateLong} at {timeHM}", { dateLong: dateLong(at, false), timeHM: timeHM(at) }), 'bell')
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={t('Reminder')} subtitle={t("Don't let the connection cool")} glow="rgb(255 210 122 / 0.25)"
      footer={<PrimaryButton className="w-full" onClick={save}>{t('Remind')}</PrimaryButton>}>
      <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={placeholder}
        className="field mt-1 text-[24px] font-semibold tracking-[-0.02em]" />

      <div className="mt-6">
        <div className="micro mb-2 px-1 text-fg-3">{t('When')}</div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map(p => <Chip key={p.label} size="sm" active={at === p.at} onClick={() => setAt(p.at)}>{p.label}</Chip>)}
        </div>
        <DateTimeField value={at} onChange={setAt} label={t('Reminder date and time')} className="mt-2.5" />
      </div>

      <div className="mt-6">
        <div className="micro mb-2 px-1 text-fg-3">{t('About whom')}</div>
        <PersonPicker multi={false} value={ids} onChange={setIds} />
      </div>

      <button type="button" onClick={() => setCal(c => !c)} className="press mt-5 flex w-full items-center gap-3 rounded-[18px] border border-line bg-white/[0.04] px-4 py-3.5 text-left">
        <CalendarPlusIcon size={20} className="text-fg-2" />
        <span className="flex-1">
          <span className="block text-[15px]">{t('Add to the phone calendar')}</span>
          <span className="block text-[12.5px] text-fg-3">{t('Downloads an .ics — the calendar will send a notification')}</span>
        </span>
        <span className={`relative h-[30px] w-[50px] rounded-full transition-colors ${cal ? 'bg-mint' : 'bg-white/15'}`}>
          <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${cal ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
        </span>
      </button>
      <div className="h-4" />
    </Sheet>
  )
}
