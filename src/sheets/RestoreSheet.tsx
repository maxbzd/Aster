import { useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { Field, TextInput } from '@/components/forms'
import { PrimaryButton } from '@/components/ui'
import { importBackup } from '@/data/actions'
import { openBackup } from '@/data/backupSeal'
import { isEncryptedBackup } from '@/data/backupFormat'
import { useUI } from '@/app/store'
import { CryptoError } from '@/crypto/password'
import { t } from '@/i18n'

/** Asks for the password of an encrypted backup, then restores it. */
export function RestoreSheet({ mode, file, onClose }: { mode: 'replace' | 'merge'; file: unknown; onClose: () => void }) {
  const toast = useUI(s => s.toast)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const byKey = isEncryptedBackup(file) && file.encrypted === 'key'

  const go = async () => {
    if (!isEncryptedBackup(file) || !secret) return
    setBusy(true); setError(null)
    try {
      const plain = await openBackup(file, secret)
      const n = await importBackup(plain, { mode })
      toast(mode === 'merge' ? t('Added from the backup: {v}', { v: n }) : t('Data restored'))
      onClose()
    } catch (e) {
      setError(e instanceof CryptoError && e.code === 'wrong_password' ? t('Wrong password, or the file is damaged.') : e instanceof Error && e.message && !(e instanceof CryptoError) ? e.message : t("Couldn't read the file"))
    } finally { setBusy(false) }
  }

  return (
    <Sheet onClose={onClose} title={t('This backup is encrypted')} subtitle={byKey ? t('Enter the passphrase you set for automatic copies.') : t('Enter the password you chose when saving it.')} glow="rgb(255 210 122 / 0.28)"
      footer={<PrimaryButton className="w-full" disabled={busy || !secret} onClick={go}>{busy ? t('Decrypting…') : mode === 'merge' ? t('Add from the backup') : t('Restore')}</PrimaryButton>}>
      <div className="glass mt-1 overflow-hidden rounded-[22px]">
        <Field label={byKey ? t('Passphrase') : t('Password')}><TextInput autoFocus type="password" autoComplete="current-password" value={secret} onChange={e => setSecret(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} /></Field>
      </div>
      {error && <p role="alert" className="mt-3 px-1 text-[13px] text-danger">{error}</p>}
      {mode === 'replace' && <p className="mt-3 px-1 text-[12.5px] text-fg-3">{t('Restoring replaces the current data.')}</p>}
      <div className="h-4" />
    </Sheet>
  )
}
