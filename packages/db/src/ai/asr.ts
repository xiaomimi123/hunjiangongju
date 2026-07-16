import fs from 'fs/promises'
import path from 'path'
import { getCapabilityConfig, isMockMode } from './config'
import { mockAsr } from './mock'
import type { AsrOpts, AsrResult } from './types'

export async function asrTranscribe(opts: AsrOpts): Promise<AsrResult> {
  const cfg = await getCapabilityConfig('asr')
  if (isMockMode(cfg)) return mockAsr()
  const bytes = await fs.readFile(opts.audioPath)
  const form = new FormData()
  form.append('file', new Blob([bytes]), path.basename(opts.audioPath))
  form.append('model', cfg.model)
  form.append('response_format', 'verbose_json')
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`ASR 请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const segments = Array.isArray(data?.segments) ? data.segments : []
  return {
    fullText: String(data?.text ?? ''),
    sentences: segments.map((s: { text: string; start: number; end: number }) => ({
      text: String(s.text ?? '').trim(),
      startMs: Math.round((s.start ?? 0) * 1000),
      endMs: Math.round((s.end ?? 0) * 1000),
    })),
  }
}
