import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AddressBookIcon, CameraIcon, CheckCircleIcon, CirclesThreeIcon, CloudArrowDownIcon, CloudCheckIcon, PlugsConnectedIcon, CloudArrowUpIcon, DeviceMobileIcon,
  DownloadSimpleIcon, FlaskIcon, LockSimpleIcon, PulseIcon, TrashIcon, VaultIcon,
} from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Avatar } from '@/components/Avatar'
import { Aurora } from '@/components/Aurora'
import { Group, Row } from '@/components/ui'
import { useAllInteractions, useCircles, useCounts, usePeople, useSettings } from '@/data/hooks'
import { BackupError, backupToFile, importBackup, saveSettings, wipeAll } from '@/data/actions'
import { toVCard } from '@/data/vcard'
import { leadsToCSV } from '@/data/leads'
import { db } from '@/data/db'
import { CLOSENESS } from '@/data/logic'
import { download } from '@/lib/ics'
import { fileToAvatar, pickFile } from '@/lib/image'
import { dateLong } from '@/lib/format'
import { PALETTES } from '@/lib/colors'
import { useUI } from '@/app/store'
import { useCloud } from '@/cloud/store'
import { statusLine } from '@/cloud/status'
import { useBridge } from '@/bridge/store'
import { useTick } from '@/ticktick/cycle'
import { AstraStar } from '@/components/astra/Astra'
import { useAstraStatus } from '@/ai/hooks'
import { cloudEnabled } from '@/cloud/config'
import { LanguagePicker } from '@/components/LanguagePicker'
import { t, tn } from '@/i18n'

export function Me() {
  const settings = useSettings()
  const cloud = useCloud()
  const cloudOn = !!cloud.userId
  const cloudStatus = statusLine(cloud)
  const bridgeLinked = useBridge(b => b.connections.some(c => c.outbound_token))
  const tickOn = !!useTick().status?.connected
  const people = usePeople(true)
  const circles = useCircles()
  const ints = useAllInteractions()
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const nav = useNavigate()
  const [wipe, setWipe] = useState(false)
  const astra = useAstraStatus()
  const counts = useCounts()
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => undefined) }, [])
  const [name, setName] = useState<string | null>(null)

  if (!settings) return <Page><div /></Page>

  const setPhoto = async () => {
    const f = await pickFile('image/*')
    if (!f) return
    await saveSettings({ photo: await fileToAvatar(f) })
    toast(t('Photo updated'))
  }

  const importVcf = async () => {
    const f = await pickFile('.vcf,text/vcard,text/x-vcard')
    if (!f) return
    open({ kind: 'importVcf', text: await f.text() })
  }

  const backup = async () => {
    await backupToFile()
    toast(t('Backup saved'))
  }

  const restore = async (mode: 'replace' | 'merge') => {
    const f = await pickFile('application/json,.json')
    if (!f) return
    try {
      let data: unknown
      try { data = JSON.parse(await f.text()) } catch { throw new BackupError(t("This file doesn't look like an Aster backup")) }
      const n = await importBackup(data, { mode })
      toast(mode === 'merge' ? t('Added from the backup: {v}', { v: n }) : t('Data restored'))
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't read the file"), 'info')
    }
  }

  const exportVcf = () => {
    download('aster-contacts.vcf', (people ?? []).map(toVCard).join('\r\n'), 'text/vcard')
    toast(t('Contacts exported'))
  }

  const byCloseness = ([1, 2, 3, 4] as const).map(c => ({ c, n: (people ?? []).filter(p => p.closeness === c && !p.archived).length }))
  const archived = (people ?? []).filter(p => p.archived).length

  return (
    <Page>
      <Aurora colors={['rgb(124 92 255 / 0.45)', 'rgb(255 140 90 / 0.25)', 'rgb(70 140 255 / 0.3)']} className="!bottom-auto h-[460px]"
        style={{ left: '-30vw', right: '-30vw', maskImage: 'linear-gradient(to bottom, #000 50%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 50%, transparent)' }} />
      <PageHeader title={t('Profile')} />

      {/* User card */}
      <div className="glass glow-card relative mt-4 flex items-center gap-4 rounded-[30px] p-5" style={{ ['--glow' as string]: 'rgb(255 160 110 / 0.3)' }}>
        <button type="button" onClick={setPhoto} className="press relative" aria-label={t('Change photo')}>
          <Avatar person={{ id: 'me', firstName: settings.name || t('Me'), photo: settings.photo }} size={72} />
          <span className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-ink bg-fg text-ink"><CameraIcon size={13} weight="bold" /></span>
        </button>
        <div className="min-w-0 flex-1">
          {name === null ? (
            <button type="button" onClick={() => setName(settings.name)} className="text-left">
              <div className="text-[22px] font-semibold tracking-[-0.02em]">{settings.name || t("What's your name?")}</div>
              <div className="text-[13px] text-fg-3">{t('tap to edit')}</div>
            </button>
          ) : (
            <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={async () => { await saveSettings({ name: name.trim() }); setName(null) }}
              onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="field text-[22px] font-semibold" />
          )}
          <div className="mt-1 text-[13px] text-fg-3">{t('In Aster since')}{' '}{dateLong(settings.createdAt)}</div>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="glass rounded-[24px] p-4">
          <div className="tnum text-[30px] font-semibold tracking-[-0.03em]">{(people ?? []).length - archived}</div>
          <div className="text-[13px] text-fg-3">{tn((people ?? []).length - archived, 'person in your network', 'people in your network')}</div>
        </div>
        <div className="glass rounded-[24px] p-4">
          <div className="tnum text-[30px] font-semibold tracking-[-0.03em]">{ints.length}</div>
          <div className="text-[13px] text-fg-3">{t('timeline entries')}</div>
        </div>
      </div>

      <button type="button" onClick={() => open({ kind: 'astra' })} className="press glass glow-card mt-3 flex w-full items-center gap-4 rounded-[26px] p-4 text-left"
        style={{ ['--glow' as string]: 'rgb(255 200 150 / 0.28)', ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
        <AstraStar size={34} />
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">{t('Astra')}</span>
          <span className="block text-[13px] text-fg-3">{astra.connected ? t('Connected · {name}', { name: astra.model?.name ?? '' }) : t('Runs on this device · connect a model')}</span>
        </span>
        <span className={`h-2.5 w-2.5 rounded-full ${astra.connected ? 'bg-mint shadow-[0_0_10px_#5fe3b0]' : 'bg-white/25'}`} />
      </button>

      {cloudEnabled() && (
        <>
        <button type="button" onClick={() => open({ kind: 'cloud' })} className="press glass glow-card mt-3 flex w-full items-center gap-4 rounded-[26px] p-4 text-left"
          style={{ ['--glow' as string]: 'rgb(95 227 176 / 0.22)', ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
          <span className="grid h-[34px] w-[34px] place-items-center text-mint"><CloudCheckIcon size={30} weight="duotone" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">{t('Cloud')}</span>
            <span className="block truncate text-[13px] text-fg-3">{cloudOn ? `${cloud.email} · ${cloudStatus.text}` : t('Sign in to have your data on all devices')}</span>
          </span>
          <span className={`h-2.5 w-2.5 rounded-full ${cloudOn && cloud.phase !== 'error' ? 'bg-mint shadow-[0_0_10px_#5fe3b0]' : cloudOn ? 'bg-danger' : 'bg-white/25'}`} />
        </button>

        <button type="button" onClick={() => open({ kind: 'bridge' })} className="press glass glow-card mt-3 flex w-full items-center gap-4 rounded-[26px] p-4 text-left"
          style={{ ['--glow' as string]: 'rgb(124 92 255 / 0.25)', ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
          <span className="grid h-[34px] w-[34px] place-items-center text-[#a796ff]"><PlugsConnectedIcon size={30} weight="duotone" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">{t('“Orbita” app')}</span>
            <span className="block truncate text-[13px] text-fg-3">{bridgeLinked ? t('Connected · commitments, records and people') : t('Link with the “Orbita” app')}</span>
          </span>
          <span className={`h-2.5 w-2.5 rounded-full ${bridgeLinked ? 'bg-mint shadow-[0_0_10px_#5fe3b0]' : 'bg-white/25'}`} />
        </button>

        <button type="button" onClick={() => open({ kind: 'ticktick' })} className="press glass glow-card mt-3 flex w-full items-center gap-4 rounded-[26px] p-4 text-left"
          style={{ ['--glow' as string]: 'rgb(95 227 176 / 0.22)', ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
          <span className="grid h-[34px] w-[34px] place-items-center text-[#5fe3b0]"><CheckCircleIcon size={30} weight="duotone" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">TickTick</span>
            <span className="block truncate text-[13px] text-fg-3">{tickOn ? t('Connected · reminders and “done”') : t('Send reminders to TickTick')}</span>
          </span>
          <span className={`h-2.5 w-2.5 rounded-full ${tickOn ? 'bg-mint shadow-[0_0_10px_#5fe3b0]' : 'bg-white/25'}`} />
        </button>

        <button type="button" onClick={() => open({ kind: 'claude' })} className="press glass glow-card mt-3 flex w-full items-center gap-4 rounded-[26px] p-4 text-left"
          style={{ ['--glow' as string]: 'rgb(255 154 82 / 0.22)', ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
          <span className="grid h-[34px] w-[34px] place-items-center text-[#ffb36b]"><AstraStar size={28} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">Claude</span>
            <span className="block truncate text-[13px] text-fg-3">{t("Log and ask right in Claude's chat")}</span>
          </span>
        </button>
        </>
      )}

      <div className="mt-8 flex flex-col gap-6">
        <Group title={t('Network')}>
          <Row icon={PulseIcon} iconColor="#ffb36b" label={t('Network pulse')} sub={t('Pulse, activity, circles')} onClick={() => nav('/pulse')} />
          <Row icon={CirclesThreeIcon} iconColor="#a796ff" label={t('Circles')} sub={circles.length ? t('{pl} · colors, order, emoji', { pl: tn(circles.length, '{n} circle', '{n} circles') }) : t('Not set up')} onClick={() => open({ kind: 'circles' })}
            trailing={<span className="flex -space-x-1">{circles.slice(0, 4).map(c => <span key={c.id} className="h-3 w-3 rounded-full ring-2 ring-ink-2" style={{ background: `linear-gradient(135deg, ${PALETTES[c.palette].from}, ${PALETTES[c.palette].to})` }} />)}</span>} />
          <div className="px-4 py-3.5">
            <div className="mb-2.5 text-[13px] text-fg-3">{t('Default rhythm per orbit')}</div>
            <div className="grid grid-cols-2 gap-2">
              {byCloseness.map(({ c, n }) => (
                <div key={c} className="rounded-[16px] bg-white/[0.04] px-3 py-2.5">
                  <div className="text-[13.5px] font-medium">{CLOSENESS[c].name} <span className="tnum text-fg-3">· {n}</span></div>
                  <div className="text-[12px] text-fg-3">{t('every')}{' '}{CLOSENESS[c].cadence}{' '}{t('days')}</div>
                </div>
              ))}
            </div>
          </div>
        </Group>

        <Group title={t('Import & export')}>
          <Row icon={VaultIcon} iconColor="#5fe3b0" label={t('Upload a list to the reserve')} sub={t('Excel, CSV, .vcf or pasted text — even 200 people at once')} onClick={() => open({ kind: 'leadImport' })} />
          <Row icon={AddressBookIcon} iconColor="#7fd6ff" label={t('Import contacts into the network')} sub={t('A .vcf file from iPhone, Android or Google')} onClick={importVcf} />
          <Row icon={DownloadSimpleIcon} label={t('Export contacts (.vcf)')} sub={t('Can be loaded onto a phone')} onClick={exportVcf} />
          {counts.leads > 0 && <Row icon={DownloadSimpleIcon} label={t('Export the reserve (.csv)')} sub={t('{pl} — opens in Excel and Google Sheets', { pl: tn(counts.leads, '{n} contact', '{n} contacts') })} onClick={async () => { download('aster-reserve.csv', leadsToCSV(await db.leads.toArray()), 'text/csv'); toast(t('Reserve exported')) }} />}
          <Row icon={CloudArrowDownIcon} iconColor={settings.lastBackupAt ? undefined : '#ffd27a'} label={t('Backup')} sub={settings.lastBackupAt ? t('Download everything as one file · last {dateLong}', { dateLong: dateLong(settings.lastBackupAt) }) : t('Download everything as one file · no backups yet')} onClick={backup} />
          <Row icon={CloudArrowUpIcon} label={t('Add from a backup')} sub={t('Merges with current data without deleting anything')} onClick={() => restore('merge')} />
          <Row icon={CloudArrowUpIcon} label={t('Restore from a backup')} sub={t('Replaces current data')} onClick={() => restore('replace')} />
        </Group>

        <Group title={t('App')}>
          <div className="px-4 py-3.5">
            <div className="mb-2.5 text-[13px] text-fg-3">{t('Language')}</div>
            <LanguagePicker />
          </div>
          <Row icon={DeviceMobileIcon} iconColor="#7fd6ff" label={t('Install on your phone')}
            sub={t('iPhone: Share → “Add to Home Screen”. Android: menu → “Install app”')} chevron={false} />
          <Row icon={LockSimpleIcon} label={cloudOn ? t('Your data is here and in the cloud') : t('Your data stays with you')} sub={cloudOn ? t("Everything is stored on the device and copied to your protected account. Astra's keys never go to the cloud.") : t('Everything is stored on this device. {v}', { v: persisted === false ? t('The browser may clear storage — install the app to your Home Screen, make backups or sign in to the cloud.') : t('Make backups or sign in to the cloud.') })} chevron={false} />
          {!cloudOn && <Row icon={FlaskIcon} label={t('Load demo data')} sub={t('32 people and 23 reserve contacts — fictional, replaces current data')} onClick={async () => { await wipeAll(); await saveSettings({ name: settings.name, photo: settings.photo, onboarded: true, createdAt: settings.createdAt, demo: true }); await (await import('@/data/demo')).loadDemo(); toast(t('Demo loaded')) }} />}
          {!wipe ? (
            <Row icon={TrashIcon} iconColor="#ff5f6d" label={<span className="text-danger">{t('Delete all data')}</span>} onClick={() => setWipe(true)} />
          ) : (
            <Row icon={TrashIcon} iconColor="#ff5f6d" label={<span className="font-semibold text-danger">{t('Really delete everything? Tap again')}</span>} sub={cloudOn ? t('It will be deleted on this device, in the cloud, and on other devices') : t("This can't be undone")}
              onClick={async () => { await wipeAll(); toast(t('All data deleted'), 'info') }} />
          )}
        </Group>
      </div>

      <div className="mt-10 text-center text-[12.5px] text-fg-4">{t('Aster 1.0 · made with care for people')}</div>
    </Page>
  )
}
