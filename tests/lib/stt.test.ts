import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkRanges, SttError, sttReady, transcribeBlob, transcribeFile, wavFromPcm } from '@/stt/client'
import { parseTranscript } from '@/stt/transcript'

describe('разбор расшифровок', () => {
  it('srt: убирает номера и время, склеивает строки одной реплики', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nПривет, Нина.\n\n2\n00:00:04,000 --> 00:00:06,000\nРасскажи про\nпереезд в Порту\n\n3\n00:00:07,000 --> 00:00:08,000\nКонечно.'
    expect(parseTranscript('meet.srt', srt)).toBe('Привет, Нина.\nРасскажи про переезд в Порту\nКонечно.')
  })

  it('vtt: заголовок, заметки и теги исчезают', () => {
    const vtt = 'WEBVTT\n\nNOTE шапка\n\n00:00:01.000 --> 00:00:02.000\n<v Олег>Давай в пятницу.</v>\n'
    expect(parseTranscript('a.vtt', vtt)).toBe('Давай в пятницу.')
  })

  it('json Whisper: segments → текст, говорящие сохраняются', () => {
    const j = JSON.stringify({ segments: [{ text: ' Привет ', speaker: 'Олег' }, { text: 'как дела', speaker: 'Олег' }, { text: 'Хорошо', speaker: 'Нина' }] })
    expect(parseTranscript('x.json', j)).toBe('Олег: Привет как дела\nНина: Хорошо')
    expect(parseTranscript('x.json', JSON.stringify({ text: 'Просто текст' }))).toBe('Просто текст')
  })

  it('txt: возвращает как есть, лишние пустые строки и BOM убирает', () => {
    expect(parseTranscript('a.txt', '﻿Олег: да\n\n\n\nНина: нет  \n')).toBe('Олег: да\n\nНина: нет')
  })

  it('битый json не ломает: возвращается исходник', () => {
    expect(parseTranscript('a.json', '{не json')).toBe('{не json')
  })
})

describe('распознавание речи', () => {
  afterEach(() => vi.restoreAllMocks())
  const s = { provider: 'openai' as const, apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1/', model: 'whisper-1', language: 'ru' }

  it('готовность: нужен провайдер и ключ', () => {
    expect(sttReady(s)).toBe(true)
    expect(sttReady({ provider: 'off', apiKey: 'x' })).toBe(false)
    expect(sttReady({ provider: 'openai' })).toBe(false)
    expect(sttReady(undefined)).toBe(false)
  })

  it('отправляет файл на /audio/transcriptions с ключом, моделью и языком', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: ' Привет, мир ' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const text = await transcribeBlob(new Blob(['x']), 'a.m4a', s)
    expect(text).toBe('Привет, мир')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('language')).toBe('ru')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('понятные ошибки: ключ, размер, сеть, без настройки', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await expect(transcribeBlob(new Blob(['x']), 'a.m4a', s)).rejects.toMatchObject({ kind: 'auth' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 413 })))
    await expect(transcribeBlob(new Blob(['x']), 'a.m4a', s)).rejects.toMatchObject({ kind: 'size' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(transcribeBlob(new Blob(['x']), 'a.m4a', s)).rejects.toMatchObject({ kind: 'network' })
    await expect(transcribeFile(new File(['x'], 'a.m4a'), { provider: 'off' })).rejects.toBeInstanceOf(SttError)
  })

  it('маленький файл — один запрос и прогресс 0 → 1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'ok' }), { status: 200 })))
    const seen: number[] = []
    expect(await transcribeFile(new File(['x'], 'a.m4a'), s, p => seen.push(p.done))).toBe('ok')
    expect(seen).toEqual([0, 1])
  })

  it('длинная дорожка режется на куски по 10 минут; WAV корректный', () => {
    expect(chunkRanges(16_000 * 1500)).toEqual([[0, 9_600_000], [9_600_000, 19_200_000], [19_200_000, 24_000_000]])
    expect(chunkRanges(0)).toEqual([])
    const wav = wavFromPcm(new Float32Array([0, 0.5, -0.5]))
    expect(wav.size).toBe(44 + 6)
    expect(wav.type).toBe('audio/wav')
  })
})
