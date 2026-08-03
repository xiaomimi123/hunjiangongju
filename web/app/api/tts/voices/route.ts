import { NextResponse } from 'next/server'
import { getCapabilityConfig, TTS_VOICES, isPlausibleVoiceId, type TtsVoice } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

// 音色清单：内置白名单（TTS_VOICES）+ tts 能力配置 extra.customVoices（运营免改码登记的音色，
// 典型为火山「声音复刻2.0」克隆得到的 S_ 开头音色 ID）。按 id 去重，内置优先，非法条目静默跳过。
export const GET = handler(async () => {
  await requireRole('operator')
  const cfg = await getCapabilityConfig('tts')
  const custom = Array.isArray(cfg.extra?.customVoices) ? (cfg.extra.customVoices as unknown[]) : []

  const voices: TtsVoice[] = [...TTS_VOICES]
  const seen = new Set(TTS_VOICES.map((v) => v.id))
  for (const raw of custom) {
    if (!raw || typeof raw !== 'object') continue
    const { id, label } = raw as Record<string, unknown>
    if (!isPlausibleVoiceId(id) || seen.has(id)) continue
    if (typeof label !== 'string' || !label.trim()) continue
    seen.add(id)
    voices.push({ id, label })
  }

  return NextResponse.json({ voices })
})
