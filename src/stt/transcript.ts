/** Parsing files with a meeting transcript: txt, md, srt, vtt, json (Whisper, Otter and the like) → plain text. */

const TIME = /^\d{1,2}:\d{2}(?::\d{2})?[.,]?\d{0,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]?\d{0,3}.*$/

function fromCues(text: string): string {
  // a subtitle is a block of lines between blank lines; the lines inside a block are one utterance
  const out: string[] = []
  for (const block of text.replace(/^﻿/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l && !/^WEBVTT/i.test(l) && !/^(NOTE|STYLE|REGION)\b/.test(l) && !/^\d+$/.test(l) && !TIME.test(l))
    const line = lines.map(l => l.replace(/<[^>]+>/g, '').replace(/\{\\an\d\}/g, '').trim()).filter(Boolean).join(' ')
    if (line) out.push(line)
  }
  return out.join('\n')
}

interface Seg { text?: string; speaker?: string; speaker_label?: string; start?: number }

function fromJson(raw: string): string {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return raw }
  const d = data as { text?: string; segments?: Seg[]; results?: { transcripts?: Array<{ transcript?: string }> }; transcript?: string | Seg[] }
  const segs = d.segments ?? (Array.isArray(d.transcript) ? d.transcript : undefined) ?? (Array.isArray(data) ? (data as Seg[]) : undefined)
  if (segs?.length) {
    const lines: string[] = []
    let last = ''
    for (const s of segs) {
      const query = (s.text ?? '').trim()
      if (!query) continue
      const who = s.speaker ?? s.speaker_label ?? ''
      if (who && who !== last) { lines.push(`${who}: ${query}`); last = who } else if (lines.length && who === last) lines[lines.length - 1] += ` ${query}`; else lines.push(query)
    }
    return lines.join('\n')
  }
  return d.text ?? d.results?.transcripts?.[0]?.transcript ?? (typeof d.transcript === 'string' ? d.transcript : raw)
}

export function parseTranscript(name: string, content: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const body = content.replace(/^﻿/, '')
  let text: string
  if (ext === 'srt' || ext === 'vtt' || /^WEBVTT/.test(body) || /^\d+\s*\r?\n\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(body)) text = fromCues(body)
  else if (ext === 'json' || /^\s*[[{]/.test(body)) text = fromJson(body)
  else text = body
  return text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const TRANSCRIPT_EXT = ['.txt', '.md', '.srt', '.vtt', '.json']
export const AUDIO_ACCEPT = 'audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.opus,.flac,.aac,.mp4,.webm,.mov'

export const isTranscriptFile = (f: { name: string; type: string }) => TRANSCRIPT_EXT.some(e => f.name.toLowerCase().endsWith(e)) || f.type.startsWith('text/')
