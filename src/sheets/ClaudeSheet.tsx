import { useCallback, useEffect, useState } from 'react'
import { CopyIcon, KeyIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { GlassButton, PrimaryButton } from '@/components/ui'
import { useCloud } from '@/cloud/store'
import { syncedAgo } from '@/cloud/status'
import { createKey, listKeys, revokeKey, type McpKey } from '@/mcp/keys'
import { useUI } from '@/app/store'
import { t, msg } from '@/i18n'

const EXAMPLES = [
  msg("“Log my meeting with Oliver Grant: we had coffee, he's looking for an investor, agreed to an intro”"),
  msg('“Add Maria Santos, a designer from Lisbon looking for mentors”'),
  msg('“Remind me on Friday at 11:00 to message Oliver about the contract”'),
  msg('“What do I have today and who should I reach out to?”'),
  msg('“What do I know about Anna?”'),
]

/** Подключение Aster к Claude: личный ключ и адрес, который добавляется в Claude как свой коннектор. */
export function ClaudeSheet({ onClose }: { onClose: () => void }) {
  const signedIn = useCloud(c => !!c.userId)
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const [keys, setKeys] = useState<McpKey[] | null>(null)
  const [fresh, setFresh] = useState<{ url: string; label: string } | null>(null)
  const [label, setLabel] = useState('Claude')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setKeys(await listKeys()); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { if (signedIn) void load() }, [signedIn, load])

  const create = async () => {
    setBusy(true); setError(null)
    try { const k = await createKey(label.trim() || 'Claude'); setFresh({ url: k.url, label: label.trim() || 'Claude' }); await load() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const revoke = async (k: McpKey) => {
    setBusy(true)
    try { await revokeKey(k.id); toast(t('Key revoked'), 'info'); await load() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast(t('Copied')) } catch { toast(t("Couldn't copy: select it manually"), 'info') }
  }

  return (
    <Sheet onClose={onClose} title="Claude" subtitle={t('Log things and ask right in the chat')} glow="rgb(255 154 82 / 0.25)" tall>
      {!signedIn ? (
        <div className="px-1 pt-1">
          <p className="text-[14.5px] leading-relaxed text-fg-3">{t('The link goes through your cloud account, so sign in to the cloud first.')}</p>
          <PrimaryButton className="mt-5 w-full" onClick={() => open({ kind: 'cloud' })}>{t('Sign in to the cloud')}</PrimaryButton>
        </div>
      ) : (
        <div>
          <p className="px-1 text-[14.5px] leading-relaxed text-fg-3">{t('Connect Aster to Claude as your own connector, and in an ordinary chat you can say: Claude will find people, log meetings, set reminders and tell you what you have today.')}</p>

          {fresh && (
            <div className="glass mt-4 rounded-[22px] p-4">
              <div className="text-[15px] font-semibold">{t('Key “')}{fresh.label}{t('” created')}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-warm">{t('The address is shown only once. Copy it now and paste it into Claude. Lost it — revoke the key and create a new one.')}</p>
              <textarea readOnly value={fresh.url} aria-label={t('Address for Claude')} onFocus={e => e.currentTarget.select()} className="mt-3 h-[92px] w-full resize-none rounded-[16px] border border-line bg-white/[0.04] p-3 font-mono text-[12px] leading-snug text-fg-2" />
              <PrimaryButton className="mt-3 w-full" onClick={() => void copy(fresh.url)}><CopyIcon size={17} className="mr-1.5 inline" />{t('Copy address')}</PrimaryButton>
              <div className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-fg-3">
                <div><span className="font-semibold text-fg-2">{t('claude.ai or the Claude app:')}</span>{' '}{t('Settings → Connectors → “Add custom connector”, name it “Aster”, paste the address.')}</div>
                <div><span className="font-semibold text-fg-2">Claude Code:</span>{' '}{t('in the terminal run the command')}
                  <button type="button" onClick={() => void copy(`claude mcp add --transport http aster ${fresh.url}`)} className="press mt-1.5 block w-full break-all rounded-[12px] bg-white/[0.05] p-2.5 text-left font-mono text-[11.5px] text-fg-2">claude mcp add --transport http aster …</button>
                  {t('(tap to copy it whole).')}
                </div>
              </div>
              <GlassButton className="mt-4 w-full" onClick={() => setFresh(null)}>{t("Done, I've copied it")}</GlassButton>
            </div>
          )}

          {error && <div role="alert" className="mt-3 flex items-start gap-2 rounded-[16px] bg-danger/10 px-4 py-3 text-[13.5px] text-danger"><WarningCircleIcon size={17} className="mt-0.5 shrink-0" />{error}</div>}

          <div className="micro mb-2 mt-6 px-1 text-fg-3">{t('Access keys')}</div>
          <div className="glass rows overflow-hidden rounded-[22px]">
            {keys === null ? <div className="px-4 py-3.5 text-[14px] text-fg-3">{t('Loading…')}</div>
              : keys.length === 0 ? <div className="px-4 py-3.5 text-[14px] text-fg-3">{t('No keys yet.')}</div>
              : keys.map(k => (
                <div key={k.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-fg-2"><KeyIcon size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{k.label}</div>
                    <div className="text-[12.5px] text-fg-3">{k.last_used_at ? t('used {syncedAgo}', { syncedAgo: syncedAgo(Date.parse(k.last_used_at)) }) : t('never used yet')}</div>
                  </div>
                  <button type="button" aria-label={t('Revoke key “{label}”', { label: k.label })} disabled={busy} onClick={() => void revoke(k)} className="press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-danger"><TrashIcon size={16} /></button>
                </div>
              ))}
          </div>

          <div className="mt-4 flex gap-2">
            <input value={label} onChange={e => setLabel(e.target.value)} maxLength={40} aria-label={t('Key name')} placeholder={t('A name, e.g. “Laptop”')} className="field glass h-12 min-w-0 flex-1 rounded-full px-4 text-[15px]" />
            <PrimaryButton disabled={busy} onClick={() => void create()}>{t('Create key')}</PrimaryButton>
          </div>

          <div className="micro mb-2 mt-7 px-1 text-fg-3">{t('What you can say to Claude')}</div>
          <ul className="space-y-2 px-1 text-[14px] leading-relaxed text-fg-3">{EXAMPLES.map(e => <li key={e}>{e}</li>)}</ul>
          <p className="mt-5 px-1 text-[12.5px] leading-relaxed text-fg-4">{t("A key gives access to Aster's people, interactions and reminders. Don't show the address to others. Details and the list of actions are in docs/MCP.md.")}</p>
        </div>
      )}
      <div className="h-4" />
    </Sheet>
  )
}
