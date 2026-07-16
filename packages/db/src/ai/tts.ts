import { getCapabilityConfig, isMockMode } from './config'
import { mockSilentWav } from './mock'
import type { TtsOpts } from './types'

export async function ttsSynthesize(opts: TtsOpts): Promise<Buffer> {
  const cfg = await getCapabilityConfig('tts')
  if (isMockMode(cfg)) return mockSilentWav(Math.max(1, Math.round(opts.text.length / 5)))
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, input: opts.text, voice: opts.voice ?? (cfg.extra.voice as string) ?? 'alloy' }),
  })
  if (!res.ok) throw new Error(`TTS 请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  return Buffer.from(await res.arrayBuffer())
}
