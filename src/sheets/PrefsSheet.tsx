import { useEffect, useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { Chip, PrimaryButton, Segmented } from '@/components/ui'
import { Field, FormGroup, TextInput } from '@/components/forms'
import { CHANNEL_ORDER, CHANNELS } from '@/components/icons'
import { db } from '@/data/db'
import { patchPerson } from '@/data/actions'
import { useUI } from '@/app/store'
import type { AddressForm, AlcoholPref, BestTime, ChannelType, Prefs } from '@/data/types'
import { t, msg } from '@/i18n'

export const ALCOHOL_LABEL: Record<AlcoholPref, string> = { get yes() { return t('Drinks') }, get no() { return t("Doesn't drink") }, get rarely() { return t('Rarely') } }
export const TIME_LABEL: Record<BestTime, string> = { get morning() { return t('Morning') }, get day() { return t('Daytime') }, get evening() { return t('Evening') }, get weekend() { return t('Weekends') } }
export const LANGUAGES = [
  { code: 'ru', label: 'Русский' }, { code: 'en', label: 'English' }, { code: 'uk', label: 'Українська' }, { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' }, { code: 'fr', label: 'Français' }, { code: 'pt', label: 'Português' },
  { code: 'other', get label() { return t('Other language') } },
]
export const prefsEmpty = (p?: Prefs) => !p || !(p.food || p.allergies || p.alcohol || p.hobbies?.length || p.address || p.bestChannel || p.bestTime || p.language)

const HOBBY_HINTS = [msg('Running'), msg('Yoga'), msg('Tennis'), msg('Travel'), msg('Coffee'), msg('Wine'), msg('Books'), msg('Movies'), msg('Music'), msg('Mountains'), msg('Cooking'), msg('Chess')]

/** How it is best to communicate with a person and what they like. Everything is optional: filled in as you get to know them. */
export function PrefsSheet({ personId, onClose }: { personId: string; onClose: () => void }) {
  const toast = useUI(s => s.toast)
  const [prefs, setPrefs] = useState<Prefs>({})
  const [channels, setChannels] = useState<ChannelType[]>([])
  const [name, setName] = useState('')
  const [hobby, setHobby] = useState('')

  useEffect(() => {
    void db.people.get(personId).then(p => {
      if (!p) return
      setName(p.firstName)
      setPrefs(p.prefs ?? {})
      setChannels(p.channels.map(c => c.type))
    })
  }, [personId])

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K] | undefined) => setPrefs(p => ({ ...p, [k]: v }))
  const toggle = <K extends keyof Prefs>(k: K, v: Prefs[K]) => set(k, prefs[k] === v ? undefined : v)
  const hobbies = prefs.hobbies ?? []
  const addHobby = (h: string) => { const query = h.trim(); if (query && !hobbies.some(x => x.toLowerCase() === query.toLowerCase())) set('hobbies', [...hobbies, query]); setHobby('') }

  const save = async () => {
    const clean: Prefs = {}
    for (const [k, v] of Object.entries(prefs)) {
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue
      ;(clean as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() : v
    }
    await patchPerson(personId, { prefs: Object.keys(clean).length ? clean : undefined })
    toast(t('Preferences saved'))
    onClose()
  }

  const channelChoices = [...new Set([...channels, ...(prefs.bestChannel ? [prefs.bestChannel] : [])])]

  return (
    <Sheet onClose={onClose} tall glow="rgb(127 214 255 / 0.28)" title={t('Preferences')} subtitle={name ? t('How to approach {name}', { name }) : undefined}
      footer={<PrimaryButton className="w-full" onClick={save}>{t('Save')}</PrimaryButton>}>
      <div className="micro mb-2 px-1 pt-1 text-fg-3">{t('Form of address')}</div>
      <Segmented<AddressForm | 'none'> value={prefs.address ?? 'none'} onChange={v => set('address', v === 'none' ? undefined : v)}
        options={[{ value: 'none', label: t('Not sure') }, { value: 'ty', label: t('Informal') }, { value: 'vy', label: t('Formal') }]} />
      <p className="mt-2 px-1 text-[12.5px] text-fg-4">{t("Astra will write drafts the way it's done with this person.")}</p>

      <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Language of communication')}</div>
      <div className="flex flex-wrap gap-1.5">{LANGUAGES.map(l => <Chip key={l.code} size="sm" active={prefs.language === l.code} onClick={() => toggle('language', l.code)}>{l.label}</Chip>)}</div>

      <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Best channel')}</div>
      {channelChoices.length ? (
        <div className="flex flex-wrap gap-1.5">
          {channelChoices.map(c => <Chip key={c} size="sm" icon={CHANNELS[c].icon} active={prefs.bestChannel === c} onClick={() => toggle('bestChannel', c)}>{CHANNELS[c].label}</Chip>)}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">{CHANNEL_ORDER.slice(0, 5).map(c => <Chip key={c} size="sm" icon={CHANNELS[c].icon} active={prefs.bestChannel === c} onClick={() => toggle('bestChannel', c)}>{CHANNELS[c].label}</Chip>)}</div>
      )}

      <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('When to write')}</div>
      <div className="flex flex-wrap gap-1.5">{(Object.keys(TIME_LABEL) as BestTime[]).map(item => <Chip key={item} size="sm" active={prefs.bestTime === item} onClick={() => toggle('bestTime', item)}>{TIME_LABEL[item]}</Chip>)}</div>

      <FormGroup title={t('Food & drink')}>
        <Field label={t('What they like')}><TextInput value={prefs.food ?? ''} onChange={e => set('food', e.target.value)} placeholder={t('Georgian food, filter coffee without milk')} /></Field>
        <Field label={t('Allergies and restrictions')} hint={t('Worth remembering when you invite them to dinner')}><TextInput value={prefs.allergies ?? ''} onChange={e => set('allergies', e.target.value)} placeholder={t("Gluten, nuts, doesn't eat meat")} /></Field>
      </FormGroup>
      <div className="micro mb-2 mt-4 px-1 text-fg-3">{t('Alcohol')}</div>
      <div className="flex flex-wrap gap-1.5">{(Object.keys(ALCOHOL_LABEL) as AlcoholPref[]).map(a => <Chip key={a} size="sm" active={prefs.alcohol === a} onClick={() => toggle('alcohol', a)}>{ALCOHOL_LABEL[a]}</Chip>)}</div>

      <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Hobbies')}</div>
      {hobbies.length > 0 && <div className="mb-2.5 flex flex-wrap gap-1.5">{hobbies.map(h => <Chip key={h} size="sm" active onClick={() => set('hobbies', hobbies.filter(x => x !== h))}>{h} ✕</Chip>)}</div>}
      <input value={hobby} onChange={e => setHobby(e.target.value)} onKeyDown={e => e.key === 'Enter' && addHobby(hobby)} placeholder={t('Add a hobby and press Enter')}
        className="h-12 w-full rounded-[16px] border border-line bg-white/[0.04] px-4 text-[15.5px] outline-none placeholder:text-fg-4" />
      <div className="mt-2.5 flex flex-wrap gap-1.5">{HOBBY_HINTS.filter(h => !hobbies.includes(t(h))).slice(0, 8).map(h => <Chip key={h} size="sm" onClick={() => addHobby(t(h))}>+ {t(h)}</Chip>)}</div>
      <div className="h-4" />
    </Sheet>
  )
}
