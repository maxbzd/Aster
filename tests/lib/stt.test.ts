import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkRanges, SttError, sttReady, transcribeBlob, transcribeFile, wavFromPcm } from '@/stt/client'
import { parseTranscript } from '@/stt/transcript'

describe('parsing transcripts', () => {
  it('srt: removes numbers and times, joins the lines of one utterance', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nПривет, Нина.\n\n2\n00:00:04,000 --> 00:00:06,000\nРасскажи про\nпереезд в Порту\n\n3\n00:00:07,000 --> 00:00:08,000\nКонечно.'
    expect(parseTranscript('meet.srt', srt)).toBe('Привет, Нина.\nРасскажи про переезд в Порту\nКонечно.')
  })

  it('vtt: the header, notes and tags disappear', () => {
    const vtt = 'WEBVTT\n\nNOTE шапка\n\n00:00:01.000 --> 00:00:02.000\n<v Олег>Давай в пятницу.</v>\n'
    expect(parseTranscript('a.vtt', vtt)).toBe('Давай в пятницу.')
  })

  it('Whisper json: segments → text, speakers are kept', () => {
    const j = JSON.stringify({ segments: [{ text: ' Привет ', speaker: 'Олег' }, { text: 'как дела', speaker: 'Олег' }, { text: 'Хорошо', speaker: 'Нина' }] })
    expect(parseTranscript('x.json', j)).toBe('Олег: Привет как дела\nНина: Хорошо')
    expect(parseTranscript('x.json', JSON.stringify({ text: 'Просто текст' }))).toBe('Просто текст')
  })

  it('txt: returned as is, extra blank lines and BOM removed', () => {
    expect(parseTranscript('a.txt', '﻿Олег: да\n\n\n\nНина: нет  \n')).toBe('Олег: да\n\nНина: нет')
  })

  it('broken json does not break: the source is returned', () => {
    expect(parseTranscript('a.json', '{не json')).toBe('{не json')
  })
})

describe('speech recognition', () => {
  afterEach(() => vi.restoreAllMocks())
  const s = { provider: 'openai' as const, apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1/', model: 'whisper-1', language: 'ru' }

  it('readiness: a provider and a key are needed', () => {
    expect(sttReady(s)).toBe(true)
    expect(sttReady({ provider: 'off', apiKey: 'x' })).toBe(false)
    expect(sttReady({ provider: 'openai' })).toBe(false)
    expect(sttReady(undefined)).toBe(false)
  })

  it('sends the file to /audio/transcriptions with the key, model and language', async () => {
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

  it('clear errors: key, size, network, no setup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await expect(transcribeBlob(new Blob(['x']), 'a.m4a', s)).rejects.toMatchObject({ kind: 'auth' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 413 })))
    await expect(transcribeBlob(new Blob(['x']), 'a.m4a', s)).rejects.toMatchObject({ kind: 'size' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(transcribeBlob(new Blob(['x']), 'a.m4a', s)).rejects.toMatchObject({ kind: 'network' })
    await expect(transcribeFile(new File(['x'], 'a.m4a'), { provider: 'off' })).rejects.toBeInstanceOf(SttError)
  })

  it('a small file: one request and progress 0 → 1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'ok' }), { status: 200 })))
    const seen: number[] = []
    expect(await transcribeFile(new File(['x'], 'a.m4a'), s, p => seen.push(p.done))).toBe('ok')
    expect(seen).toEqual([0, 1])
  })

  it('a long track is cut into 10-minute pieces; the WAV is correct', () => {
    expect(chunkRanges(16_000 * 1500)).toEqual([[0, 9_600_000], [9_600_000, 19_200_000], [19_200_000, 24_000_000]])
    expect(chunkRanges(0)).toEqual([])
    const wav = wavFromPcm(new Float32Array([0, 0.5, -0.5]))
    expect(wav.size).toBe(44 + 6)
    expect(wav.type).toBe('audio/wav')
  })
})
