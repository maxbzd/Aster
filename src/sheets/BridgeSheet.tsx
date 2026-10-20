import { useState } from 'react'
import { ArrowsClockwiseIcon, CheckCircleIcon, CopyIcon, LinkBreakIcon, LinkIcon, PlugsConnectedIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { GlassButton, Group, PrimaryButton, Row } from '@/components/ui'
import { useCloud } from '@/cloud/store'
import { syncedAgo } from '@/cloud/status'
import { acceptSuggestion, dismissSuggestion } from '@/bridge/suggestions'
import { useBridge } from '@/bridge/store'
import { changeScopes, disconnect, enterCode, linkPeople, makeCode, runBridge, unlinkPeople } from '@/bridge/service'
import { describeBridgeError, SCOPE_LABEL, SCOPES, type Connection, type Scope } from '@/bridge/protocol'
import { useSuggestions } from '@/bridge/hooks'
import { usePeopleOverview } from '@/bridge/overview'
import { useUI } from '@/app/store'
import { t, tn, msg } from '@/i18n'

const PEER = msg('Orbit')

export function BridgeSheet({ onClose }: { onClose: () => void }) {
  const signedIn = useCloud(c => !!c.userId)
  const open = useUI(s => s.open)
  const { connections, phase, lastCycleAt, revoked, error } = useBridge()
  const connected = connections.filter(c => c.outbound_token)

  return (
    <Sheet onClose={onClose} title={t('Orbit')} subtitle={t('Life journal · connected to Aster')} glow="rgb(124 92 255 / 0.28)" tall>
      {!signedIn ? (
        <div className="px-1 pt-1">
          <p className="text-[14.5px] leading-relaxed text-fg-3">{t('To exchange data between the apps, first sign in to the cloud in both: the link goes through your accounts.')}</p>
          <PrimaryButton className="mt-5 w-full" onClick={() => open({ kind: 'cloud' })}>{t('Sign in to the cloud')}</PrimaryButton>
        </div>
      ) : connected.length === 0 ? <Connect />
        : (
          <div>
            {revoked && <div role="alert" className="mb-3 flex items-start gap-2 rounded-[16px] bg-danger/10 px-4 py-3 text-[13.5px] text-danger"><WarningCircleIcon size={17} className="mt-0.5 shrink-0" />{t('Orbita has dropped the connection. Disconnect it here and connect again.')}</div>}
            {connected.map(c => <ConnectionCard key={c.id} c={c} phase={phase} lastCycleAt={lastCycleAt} error={error} />)}
            <People />
            <Suggestions />
          </div>
        )}
      <div className="h-4" />
    </Sheet>
  )
}

/* ---------- подключение ---------- */

function Connect() {
  const [mode, setMode] = useState<'menu' | 'show' | 'enter'>('menu')
  const [code, setCode] = useState<{ text: string; expiresAt: string } | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const toast = useUI(s => s.toast)

  const show = async () => {
    setBusy(true); setError(null)
    try { setCode(await makeCode()); setMode('show') } catch (e) { setError(describeBridgeError(e)) } finally { setBusy(false) }
  }
  const enter = async () => {
    setBusy(true); setError(null)
    try { await enterCode(input); toast(t('Orbita connected')) } catch (e) { setError(describeBridgeError(e)) } finally { setBusy(false) }
  }
  const copy = async () => {
    if (!code) return
    try { await navigator.clipboard.writeText(code.text); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setError(t("Couldn't copy — select the code manually")) }
  }

  if (mode === 'show' && code) {
    return (
      <div>
        <p className="px-1 text-[14.5px] leading-relaxed text-fg-3">{t('Open Orbita → Settings → “Apps”, choose “Enter code” and paste this. The code is single-use and valid for 10 minutes.')}</p>
        <textarea readOnly value={code.text} aria-label={t('Connection code')} onFocus={e => e.currentTarget.select()}
          className="mt-3 h-[116px] w-full resize-none rounded-[18px] border border-line bg-white/[0.04] p-3 font-mono text-[12px] leading-snug text-fg-2" />
        <div className="mt-3 flex gap-2">
          <PrimaryButton className="flex-1" onClick={copy}><CopyIcon size={17} className="mr-1.5 inline" />{copied ? t('Copied') : t('Copy')}</PrimaryButton>
          <GlassButton className="flex-1" onClick={() => { setMode('menu'); setCode(null) }}>{t('Done')}</GlassButton>
        </div>
        {error && <div role="alert" className="mt-3 px-1 text-[13.5px] text-danger">{error}</div>}
      </div>
    )
  }
  if (mode === 'enter') {
    return (
      <div>
        <p className="px-1 text-[14.5px] leading-relaxed text-fg-3">{t('Paste the code Orbita showed (Settings → “Apps” → “Show code”).')}</p>
        <textarea autoFocus value={input} onChange={e => setInput(e.target.value)} aria-label={t('Code from Orbita')} placeholder="bridge1.…"
          className="mt-3 h-[116px] w-full resize-none rounded-[18px] border border-line bg-white/[0.04] p-3 font-mono text-[12px] leading-snug" />
        {error && <div role="alert" className="mt-3 px-1 text-[13.5px] text-danger">{error}</div>}
        <PrimaryButton className="mt-4 w-full" disabled={busy || !input.trim()} onClick={enter}>{busy ? t('Connecting…') : t('Connect')}</PrimaryButton>
        <GlassButton className="mt-2 w-full" onClick={() => { setMode('menu'); setError(null) }}>{t('Back')}</GlassButton>
      </div>
    )
  }
  return (
    <div>
      <p className="px-1 text-[14.5px] leading-relaxed text-fg-3">{t("Connect Orbita — and its commitments will become reminders here, meeting records will land in people's timelines, and each person will show what Orbita knows about them.")}</p>
      <div className="mt-4">
        <Group>
          <Row icon={PlugsConnectedIcon} iconColor="#a796ff" label={t('Show code')} sub={t("I'll create a code, you paste it into Orbita")} onClick={busy ? undefined : () => void show()} />
          <Row icon={LinkIcon} iconColor="#7fd6ff" label={t('Enter code')} sub={t('If Orbita showed the code')} onClick={() => setMode('enter')} />
        </Group>
      </div>
      {error && <div role="alert" className="mt-3 px-1 text-[13.5px] text-danger">{error}</div>}
    </div>
  )
}

function ConnectionCard({ c, phase, lastCycleAt, error }: { c: Connection; phase: string; lastCycleAt?: number; error?: string }) {
  const toast = useUI(s => s.toast)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = phase === 'syncing' ? t('Syncing…') : phase === 'offline' ? t('Offline') : phase === 'error' ? (error ?? t('Failed')) : lastCycleAt ? t('Synced · {syncedAgo}', { syncedAgo: syncedAgo(lastCycleAt) }) : t('Connected')
  const toggle = async (s: Scope) => {
    const next = c.scopes.includes(s) ? c.scopes.filter(x => x !== s) : [...c.scopes, s]
    try { await changeScopes(c, next) } catch (e) { toast(describeBridgeError(e), 'info') }
  }
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3.5 rounded-[22px] border border-line bg-white/[0.03] p-4">
        <CheckCircleIcon size={28} weight="duotone" className={phase === 'error' ? 'text-danger' : 'text-mint'} />
        <div className="min-w-0 flex-1">
          <div className="text-[15.5px] font-semibold">{c.peer_label || PEER}{' '}{t('connected')}</div>
          <div className="truncate text-[13px] text-fg-3" role="status">{status}</div>
        </div>
        <button type="button" aria-label={t('Sync now')} onClick={async () => { await runBridge() }} className="press grid h-10 w-10 place-items-center rounded-full bg-white/[0.06]"><ArrowsClockwiseIcon size={18} /></button>
      </div>

      <div className="micro mb-2 mt-4 px-1 text-fg-3">{t('What I share with Orbita')}</div>
      <Group>
        {SCOPES.map(s => (
          <button key={s} type="button" role="switch" aria-checked={c.scopes.includes(s)} onClick={() => void toggle(s)} className="press flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <span className="flex-1 text-[15px]">{SCOPE_LABEL[s]}</span>
            <span className={`relative h-[30px] w-[50px] rounded-full transition-colors ${c.scopes.includes(s) ? 'bg-mint' : 'bg-white/15'}`}>
              <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${c.scopes.includes(s) ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
            </span>
          </button>
        ))}
      </Group>

      <div className="mt-3">
        <Group>
          {!confirm ? (
            <Row icon={LinkBreakIcon} iconColor="#ff5f6d" label={<span className="text-danger">{t('Disconnect')}</span>} sub={t('Orbita will stop receiving data from Aster, and vice versa')} onClick={() => setConfirm(true)} />
          ) : (
            <div className="px-4 py-3.5">
              <div className="text-[15px] font-semibold">{t('Disconnect Orbita?')}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-3">{t("Reminders and records that have already arrived will stay. New ones won't be exchanged.")}</p>
              <div className="mt-3 flex gap-2">
                <GlassButton className="flex-1" onClick={() => setConfirm(false)}>{t('Cancel')}</GlassButton>
                <PrimaryButton className="flex-1" disabled={busy} onClick={async () => { setBusy(true); try { await disconnect(c) } finally { setBusy(false) } }}>{t('Disconnect')}</PrimaryButton>
              </div>
            </div>
          )}
        </Group>
      </div>
    </div>
  )
}

/* ---------- люди ---------- */

function People() {
  const ov = usePeopleOverview()
  const toast = useUI(s => s.toast)
  const [all, setAll] = useState(false)
  if (!ov) return null
  const act = async (fn: () => Promise<void>) => { try { await fn() } catch (e) { toast(describeBridgeError(e), 'info') } }
  return (
    <div className="mt-6">
      <div className="micro mb-2 px-1 text-fg-3">{t('People')}</div>
      <p className="mb-3 px-1 text-[13.5px] leading-relaxed text-fg-3">
        {t('In Orbita')}{' '}{tn(ov.peerCount, '{n} person', '{n} people')}{t(', linked')}{' '}{ov.linked.length}{t('. People with the same full name are linked automatically; the rest is up to you.')}
      </p>
      {ov.candidates.length > 0 && (
        <Group>
          {ov.candidates.slice(0, 8).map(c => (
            <div key={`${c.localId}-${c.peerId}`} className="flex items-center gap-3 px-4 py-3">
              <Avatar person={c.person} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px]">{c.person.firstName} {c.person.lastName ?? ''} <span className="text-fg-3">=</span> {c.peerName}</div>
                <div className="text-[12px] text-fg-3">{c.reason}</div>
              </div>
              <button type="button" onClick={() => void act(() => linkPeople(c.localId, c.peerId))} className="press rounded-full bg-fg px-3 py-1.5 text-[12.5px] font-semibold text-ink">{t('Same person')}</button>
              <button type="button" aria-label={t('These are different people')} onClick={() => void act(() => unlinkPeople(c.localId, c.peerId))} className="press rounded-full bg-white/[0.07] px-3 py-1.5 text-[12.5px] text-fg-2">{t('No')}</button>
            </div>
          ))}
        </Group>
      )}
      {ov.linked.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setAll(a => !a)} className="press px-1 text-[13.5px] text-fg-2">{all ? t('Hide linked') : t('Show linked ({count})', { count: ov.linked.length })}</button>
          {all && (
            <div className="mt-2">
              <Group>
                {ov.linked.map(l => (
                  <div key={l.localId} className="flex items-center gap-3 px-4 py-3">
                    <Avatar person={l.person} size={32} />
                    <div className="min-w-0 flex-1 truncate text-[14.5px]">{l.person.firstName} {l.person.lastName ?? ''} <span className="text-fg-3">=</span> {l.peerName}</div>
                    <button type="button" onClick={() => void act(() => unlinkPeople(l.localId, l.peerId))} className="press rounded-full bg-white/[0.07] px-3 py-1.5 text-[12.5px] text-fg-2">{t('Unlink')}</button>
                  </div>
                ))}
              </Group>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- предложения ---------- */

function Suggestions() {
  const list = useSuggestions()
  const toast = useUI(s => s.toast)
  if (!list.length) return null
  return (
    <div className="mt-6">
      <div className="micro mb-2 flex items-center px-1 text-fg-3"><span className="flex-1">{t('From Orbita')}</span>
        <button type="button" className="press text-fg-2" onClick={async () => { for (const s of list) await acceptSuggestion(s); toast(t('Added: {count}', { count: list.length })) }}>{t('Add all')}</button>
      </div>
      <Group>
        {list.slice(0, 20).map(s => (
          <div key={s.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] leading-snug">{s.title}</div>
              <div className="text-[12.5px] text-fg-3">{s.kind === 'capture' ? t('to the timeline') : t('to the card')} · {s.personName}{s.day ? ` · ${s.day}` : ''}</div>
            </div>
            <button type="button" onClick={() => void acceptSuggestion(s)} className="press rounded-full bg-fg px-3 py-1.5 text-[12.5px] font-semibold text-ink">{t('Add')}</button>
            <button type="button" aria-label={t('Hide')} onClick={() => void dismissSuggestion(s)} className="press rounded-full bg-white/[0.07] px-3 py-1.5 text-[12.5px] text-fg-2">{t('Hide')}</button>
          </div>
        ))}
      </Group>
    </div>
  )
}
