import { useEffect, useState } from 'react'
import { FolderOpenIcon, LockKeyIcon, WarningIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Field, FormGroup, TextInput } from '@/components/forms'
import { PrimaryButton } from '@/components/ui'
import { useSettings } from '@/data/hooks'
import { backupToFile, exportBackup, saveSettings } from '@/data/actions'
import { runAutoBackup } from '@/data/autoBackup'
import { createAutoBackupKey, sealBackupWithPassword } from '@/data/backupSeal'
import { folderAccess, folderBackupSupported, forgetFolder, pickFolder } from '@/lib/folder'
import { download } from '@/lib/ics'
import { dateLong } from '@/lib/format'
import { useUI } from '@/app/store'
import { t } from '@/i18n'

const MIN = 8

/** Checks a new password or passphrase; `null` when it is fine. */
export function passwordProblem(password: string, repeat: string): string | null {
  if (password.length < MIN) return t('Use at least {n} characters.', { n: MIN })
  if (password !== repeat) return t('The two entries do not match.')
  return null
}

function PasswordPair({ label, password, repeat, onPassword, onRepeat }: { label: string; password: string; repeat: string; onPassword: (v: string) => void; onRepeat: (v: string) => void }) {
  return (
    <div className="glass overflow-hidden rounded-[22px] divide-y divide-line">
      <Field label={label}><TextInput type="password" autoComplete="new-password" value={password} onChange={e => onPassword(e.target.value)} /></Field>
      <Field label={t('Repeat it')}><TextInput type="password" autoComplete="new-password" value={repeat} onChange={e => onRepeat(e.target.value)} /></Field>
    </div>
  )
}

/** Save a backup file (encrypted by default), and set up automatic encrypted copies into a folder. */
export function BackupSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings()
  const toast = useUI(s => s.toast)
  const [encrypted, setEncrypted] = useState(true)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const auto = settings?.autoBackup
  const supported = folderBackupSupported()
  const [phrase, setPhrase] = useState('')
  const [phraseRepeat, setPhraseRepeat] = useState('')
  const [access, setAccess] = useState<'none' | 'granted' | 'prompt' | 'denied'>('none')
  useEffect(() => { if (auto) void folderAccess().then(setAccess).catch(() => setAccess('none')) }, [auto])

  const save = async () => {
    if (encrypted) {
      const problem = passwordProblem(password, repeat)
      if (problem) { setError(problem); return }
    }
    setBusy(true); setError(null)
    try {
      if (encrypted) {
        const file = await sealBackupWithPassword(await exportBackup(), password)
        download(`aster-backup-${new Date().toISOString().slice(0, 10)}.aster.json`, JSON.stringify(file), 'application/json')
        await saveSettings({ lastBackupAt: Date.now() })
      } else await backupToFile()
      toast(t('Backup saved'))
      onClose()
    } catch {
      setError(t("Couldn't save the backup"))
    } finally { setBusy(false) }
  }

  const chooseFolder = async () => {
    const problem = passwordProblem(phrase, phraseRepeat)
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    try {
      const folder = await pickFolder()
      if (!folder) return
      const key = await createAutoBackupKey(phrase)
      await saveSettings({ autoBackup: { ...key, folder: folder.name, everyDays: 1 } })
      const result = await runAutoBackup({ force: true })
      toast(result === 'written' ? t('The first copy is saved') : t('Automatic copies are on'))
      setPhrase(''); setPhraseRepeat('')
    } catch {
      setError(t("Couldn't set up the folder"))
    } finally { setBusy(false) }
  }

  const now = async () => {
    setBusy(true)
    try {
      setAccess(await folderAccess(true))
      const result = await runAutoBackup({ force: true })
      toast(result === 'written' ? t('Backup saved') : t("Couldn't save the backup"), result === 'written' ? undefined : 'info')
    } finally { setBusy(false) }
  }

  const off = async () => {
    await forgetFolder()
    await saveSettings({ autoBackup: undefined })
    toast(t('Automatic copies are off'), 'info')
  }

  return (
    <Sheet onClose={onClose} title={t('Backup')} subtitle={t('Your data lives only on this device, so a copy is your insurance.')} glow="rgb(255 210 122 / 0.28)" tall>
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex gap-2">
          {([true, false] as const).map(enc => (
            <button key={String(enc)} type="button" aria-pressed={encrypted === enc} onClick={() => { setEncrypted(enc); setError(null) }}
              className={`press glass flex-1 rounded-[18px] px-3 py-3 text-left text-[14px] ${encrypted === enc ? '!border-white/30' : 'opacity-60'}`}>
              <span className="mb-0.5 flex items-center gap-1.5 font-semibold">{enc && <LockKeyIcon size={15} weight="bold" />}{enc ? t('Encrypted file') : t('Plain file')}</span>
              <span className="text-[12.5px] text-fg-3">{enc ? t('Only your password opens it. Recommended.') : t('Readable by anyone who finds it.')}</span>
            </button>
          ))}
        </div>

        {encrypted && (
          <>
            <PasswordPair label={t('Password for this file')} password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} />
            <p className="flex gap-2 px-1 text-[12.5px] leading-snug text-fg-3"><WarningIcon size={15} className="mt-px shrink-0 text-warm" />{t('If you forget the password, the file cannot be opened. There is no way to recover it.')}</p>
          </>
        )}
        {error && <p role="alert" className="px-1 text-[13px] text-danger">{error}</p>}
        <PrimaryButton className="mt-1 w-full" disabled={busy} onClick={save}>{busy ? t('Working…') : t('Save a backup file')}</PrimaryButton>
      </div>

      {supported && (
        <FormGroup title={t('Automatic copies')}>
          {!auto ? (
            <div className="flex flex-col gap-2">
              <p className="px-1 text-[13px] leading-snug text-fg-3">{t('Aster saves an encrypted copy into a folder you choose, every day, without asking for the password. You need the passphrase below only to restore. Pick a folder that is synced, for example iCloud Drive or Google Drive.')}</p>
              <PasswordPair label={t('Passphrase for restoring')} password={phrase} repeat={phraseRepeat} onPassword={setPhrase} onRepeat={setPhraseRepeat} />
              <button type="button" disabled={busy} onClick={chooseFolder} className="press glass flex items-center justify-center gap-2 rounded-[18px] py-3 text-[15px] font-semibold"><FolderOpenIcon size={18} />{t('Choose a folder')}</button>
            </div>
          ) : (
            <div className="glass flex flex-col gap-3 rounded-[22px] p-4">
              <div className="text-[14px]"><span className="font-semibold">{t('Folder')}: </span>{auto.folder}</div>
              <div className="text-[13px] text-fg-3">{auto.lastAt ? t('Last copy: {date}', { date: dateLong(auto.lastAt) }) : t('No copies yet')}</div>
              {access !== 'granted' && <p className="text-[13px] text-warm">{t('The browser asks to allow access to the folder again.')}</p>}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={now} className="press hit flex-1 rounded-full bg-fg px-4 py-2.5 text-[14px] font-semibold text-ink">{access === 'granted' ? t('Back up now') : t('Allow and back up')}</button>
                <button type="button" onClick={off} className="press hit rounded-full px-4 py-2.5 text-[14px] text-danger">{t('Turn off')}</button>
              </div>
            </div>
          )}
        </FormGroup>
      )}
      <div className="h-4" />
    </Sheet>
  )
}
