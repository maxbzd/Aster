import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { friendlyCloudError, getClient, hasStoredSession, MIN_PASSWORD, parseAuthHash } from './auth'
import { cloudEnabled } from './config'
import { SyncController } from './controller'
import { clearLocalData, delMeta, installTracking, pendingCount } from './engine'
import { supabaseRemote } from './remote'
import { setCloud, useCloud } from './store'
import { t } from '@/i18n'

/**
 * Склейка: вход/выход, ссылки из писем, запуск и остановка синхронизации.
 * Всё, что видит интерфейс, — это useCloud (состояние) и функции отсюда.
 */

let client: SupabaseClient | null = null
let controller: SyncController | null = null
let controllerUser: string | null = null
let booted = false

let bridgeStarted = false

/** Мост с другим приложением работает, пока человек вошёл в облако: подгружается лениво. */
function startBridgeLater() {
  bridgeStarted = true
  void import('@/bridge/service').then(m => m.startBridge()).catch(() => { bridgeStarted = false })
}

function stopController() {
  if (bridgeStarted) { bridgeStarted = false; void import('@/bridge/service').then(m => m.stopBridge()) }
  controller?.stop()
  controller = null
  controllerUser = null
}

function attach(c: SupabaseClient, session: Session | null) {
  if (!session) {
    stopController()
    setCloud({ phase: 'off', userId: undefined, email: undefined, pending: 0, error: undefined })
    return
  }
  const uid = session.user.id
  setCloud({ email: session.user.email ?? undefined, userId: uid, expired: false })
  if (controllerUser === uid) return // та же сессия (обновился токен) — ничего не перезапускаем
  stopController()
  controllerUser = uid
  const ctl = new SyncController({
    remote: supabaseRemote(c),
    userId: uid,
    report: setCloud,
    subscribe: ping => {
      const ch = c.channel(`records-${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${uid}` }, ping).subscribe()
      return () => { void c.removeChannel(ch) }
    },
  })
  controller = ctl
  setCloud({ phase: 'syncing' })
  ctl.start().then(() => { if (controller === ctl) startBridgeLater() }).catch(e => setCloud({ phase: 'error', error: friendlyCloudError(e) }))
}

function watchAuth(c: SupabaseClient) {
  c.auth.onAuthStateChange((event, session) => {
    // внутри обработчика нельзя ждать вызовов Supabase — выносим из него
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') setCloud({ recovery: true })
      if (event === 'SIGNED_OUT') {
        const wasIn = !!controllerUser
        attach(c, null)
        if (wasIn) setCloud({ expired: true })
      } else attach(c, session)
    }, 0)
  })
}

async function ensureClient(): Promise<SupabaseClient> {
  if (!client) {
    client = await getClient()
    watchAuth(client)
  }
  return client
}

/** Вызывается один раз при запуске приложения. */
export async function bootCloud(): Promise<void> {
  if (booted) return
  booted = true
  installTracking() // отслеживание правок включаем сразу: даже до входа не теряем изменения
  if (!cloudEnabled()) return

  const link = parseAuthHash(window.location.hash)
  if (!hasStoredSession() && !link) return

  setCloud({ phase: 'starting' })
  try {
    const c = await ensureClient()
    if (link) await handleAuthLink(c, link)
    const { data } = await c.auth.getSession()
    attach(c, data.session)
  } catch (e) {
    setCloud({ phase: 'error', error: friendlyCloudError(e) })
  }
}

async function handleAuthLink(c: SupabaseClient, link: NonNullable<ReturnType<typeof parseAuthHash>>) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
  if (link.error) { setCloud({ error: link.error }); return }
  if (link.accessToken && link.refreshToken) {
    const { error } = await c.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
    if (error) { setCloud({ error: friendlyCloudError(error) }); return }
    if (link.type === 'recovery') setCloud({ recovery: true })
  }
}

/* ---------- действия ---------- */

export async function signIn(email: string, password: string): Promise<void> {
  const c = await ensureClient()
  const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(friendlyCloudError(error))
  attach(c, data.session)
}

/** 'signed-in' — сразу вошли; 'confirm' — на почту отправлено письмо, нужно подтвердить. */
export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm'> {
  if (password.length < MIN_PASSWORD) throw new Error(t('The password must be at least {MIN_PASSWORD} characters', { MIN_PASSWORD }))
  const c = await ensureClient()
  const redirect = `${window.location.origin}${window.location.pathname}`
  const { data, error } = await c.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirect } })
  if (error) throw new Error(friendlyCloudError(error))
  // Supabase не сообщает, что почта занята: возвращает пользователя без identities
  if (data.user?.identities && data.user.identities.length === 0) throw new Error(t('This email is already registered — sign in'))
  if (data.session) { attach(c, data.session); return 'signed-in' }
  return 'confirm'
}

export async function resetPassword(email: string): Promise<void> {
  const c = await ensureClient()
  const redirect = `${window.location.origin}${window.location.pathname}`
  const { error } = await c.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect })
  if (error) throw new Error(friendlyCloudError(error))
}

export async function setNewPassword(password: string): Promise<void> {
  if (password.length < MIN_PASSWORD) throw new Error(t('The password must be at least {MIN_PASSWORD} characters', { MIN_PASSWORD }))
  const c = await ensureClient()
  const { error } = await c.auth.updateUser({ password })
  if (error) throw new Error(friendlyCloudError(error))
  setCloud({ recovery: false })
}

export const syncNow = () => controller?.syncNow() ?? Promise.resolve()
export const resync = () => controller?.resync() ?? Promise.resolve()

export class UnsyncedError extends Error {
  constructor(public pending: number) {
    super(t('Unsent changes: {pending}', { pending }))
  }
}

/**
 * Выход с этого устройства: сначала досылаем всё, что накопилось, затем убираем данные с устройства
 * (в облаке они остаются). Если досылать нечем (нет сети), без force выбрасывает UnsyncedError.
 */
export async function signOut(opts: { force?: boolean } = {}): Promise<void> {
  const c = await ensureClient()
  if (controller) await controller.syncNow()
  const pending = await pendingCount()
  if (pending > 0 && !opts.force) throw new UnsyncedError(pending)
  stopController()
  await c.auth.signOut({ scope: 'local' }).catch(() => undefined)
  await clearLocalData()
  setCloud({ phase: 'off', userId: undefined, email: undefined, pending: 0, error: undefined, recovery: false })
}

/** Удалить аккаунт и все данные в облаке; локальные данные остаются на устройстве. */
export async function deleteAccount(): Promise<void> {
  const c = await ensureClient()
  stopController()
  const { error } = await c.rpc('delete_my_account')
  if (error) throw new Error(friendlyCloudError(error))
  await c.auth.signOut({ scope: 'local' }).catch(() => undefined)
  try { localStorage.removeItem('aster-auth') } catch { /* noop */ }
  await Promise.all([delMeta('userId'), delMeta('cursor'), delMeta('lastSyncAt')])
  setCloud({ phase: 'off', userId: undefined, email: undefined, pending: 0, error: undefined })
}

export const isSignedIn = () => !!useCloud.getState().userId
