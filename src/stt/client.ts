import type { SttSettings } from '@/data/types'
import { authedFetch, serverBase } from '@/ai/managed'
import { t } from '@/i18n'

/**
 * Настоящее распознавание речи: запись уходит на OpenAI-совместимый сервер (OpenAI, Groq и т. п.) с ключом пользователя.
 * Длинные записи режутся на куски по минутам: у серверов есть лимит размера файла (обычно 25 МБ).
 */

export interface SttPreset { id: string; label: string; baseUrl: string; model: string; hint: string }

export const STT_PRESETS: SttPreset[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', get hint() { return t('Accurate and inexpensive; get a key at platform.openai.com') } },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', get hint() { return t('Very fast; get a key at console.groq.com') } },
]

export const MAX_UPLOAD = 24 * 1024 * 1024
const CHUNK_SECONDS = 600
const RATE = 16_000

export class SttError extends Error {
  constructor(message: string, readonly kind: 'config' | 'auth' | 'size' | 'network' | 'other' = 'other') { super(message) }
}

/** managed — ключ на сервере, вход по аккаунту; openai — свой ключ и сервер */
export const sttReady = (s?: SttSettings): s is SttSettings => !!s && (s.provider === 'managed' || (s.provider === 'openai' && !!s.apiKey?.trim()))

const endpoint = (s: SttSettings) => `${(s.baseUrl?.trim() || STT_PRESETS[0]!.baseUrl).replace(/\/$/, '')}/audio/transcriptions`

/** Имена людей из сети: серверное распознавание (Deepgram) узнаёт их точнее. Уходят только слова, без карточек. */
export async function networkTerms(): Promise<string[]> {
  const { db } = await import('@/data/db')
  const out = new Set<string>()
  for (const p of await db.people.toArray()) for (const w of [p.firstName, p.lastName, p.nickname, [p.firstName, p.lastName].filter(Boolean).join(' ')]) if (w?.trim()) out.add(w.trim())
  return [...out].slice(0, 100)
}

export async function transcribeBlob(blob: Blob, name: string, s: SttSettings, signal?: AbortSignal, terms?: string[]): Promise<string> {
  if (!sttReady(s)) throw new SttError(t("Speech recognition isn't set up: add a key in Astra's settings"), 'config')
  const form = new FormData()
  form.append('file', blob, name)
  form.append('model', s.model?.trim() || STT_PRESETS[0]!.model)
  form.append('response_format', 'json')
  if (s.language?.trim()) form.append('language', s.language.trim())
  const managed = s.provider === 'managed'
  if (managed && terms?.length) form.append('keyterms', terms.join(','))
  let res: Response
  try {
    res = managed
      ? await authedFetch(`${serverBase()}/stt`, { method: 'POST', body: form, signal })
      : await fetch(endpoint(s), { method: 'POST', headers: { Authorization: `Bearer ${s.apiKey!.trim()}` }, body: form, signal })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new SttError(t('No connection to the speech-recognition server'), 'network')
  }
  if (managed && res.status === 401) throw new SttError(t('Sign-in required — open “Cloud” and sign in'), 'auth')
  if (managed && res.status === 403) throw new SttError(t("Server speech recognition isn't available for this account"), 'auth')
  if (managed && res.status === 503) throw new SttError(t('No recognition key is set on the server'), 'config')
  if (res.status === 401 || res.status === 403) throw new SttError(t('The recognition key was rejected — check it in the settings'), 'auth')
  if (res.status === 413) throw new SttError(t('The file is too large for the server'), 'size')
  if (!res.ok) throw new SttError(t('The recognition server returned an error ({status})', { status: res.status }), 'other')
  const data = (await res.json().catch(() => null)) as { text?: string } | null
  return (data?.text ?? '').trim()
}

/** Моно WAV 16 кГц из кусочка PCM: компактно и понятно любому серверу. */
export function wavFromPcm(pcm: Float32Array, rate = RATE): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const str = (o: number, value: string) => { for (let i = 0; i < value.length; i++) v.setUint8(o + i, value.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i]!)) * 0x7fff, true)
  return new Blob([buf], { type: 'audio/wav' })
}

/** Делит дорожку на куски ≈10 минут; возвращает границы в отсчётах. */
export const chunkRanges = (total: number, rate = RATE, seconds = CHUNK_SECONDS): Array<[number, number]> => {
  const size = rate * seconds
  const out: Array<[number, number]> = []
  for (let a = 0; a < total; a += size) out.push([a, Math.min(total, a + size)])
  return out
}

async function decodeToMono16k(file: Blob): Promise<Float32Array> {
  const ctxCls = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new ctxCls()
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer())
    const frames = Math.ceil(decoded.duration * RATE)
    const off = new OfflineAudioContext(1, frames, RATE)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start()
    return (await off.startRendering()).getChannelData(0)
  } finally {
    void ctx.close()
  }
}

export interface TranscribeProgress { done: number; total: number }

/** Файл → текст. Маленький файл уходит как есть, большой режется на куски. */
export async function transcribeFile(file: File, s: SttSettings, onProgress?: (p: TranscribeProgress) => void, signal?: AbortSignal, terms?: string[]): Promise<string> {
  if (!sttReady(s)) throw new SttError(t("Speech recognition isn't set up: add a key in Astra's settings"), 'config')
  if (file.size <= MAX_UPLOAD) {
    onProgress?.({ done: 0, total: 1 })
    const value2 = await transcribeBlob(file, file.name, s, signal, terms)
    onProgress?.({ done: 1, total: 1 })
    return value2
  }
  let pcm: Float32Array
  try { pcm = await decodeToMono16k(file) } catch { throw new SttError(t("Couldn't read the recording: the format isn't supported by the browser"), 'other') }
  const ranges = chunkRanges(pcm.length)
  const parts: string[] = []
  for (let i = 0; i < ranges.length; i++) {
    onProgress?.({ done: i, total: ranges.length })
    const [a, b] = ranges[i]!
    parts.push(await transcribeBlob(wavFromPcm(pcm.subarray(a, b)), `part-${i + 1}.wav`, s, signal, terms))
  }
  onProgress?.({ done: ranges.length, total: ranges.length })
  return parts.filter(Boolean).join('\n\n')
}
