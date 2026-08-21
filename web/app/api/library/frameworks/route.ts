import { NextResponse } from 'next/server'
import { prisma, readFrameworkVoices, getCapabilityConfig, TTS_VOICES, isPlausibleVoiceId } from '@mixcut/db'
import { requireRole } from '@/lib/auth'
import { handler } from '@/lib/api'

export const GET = handler(async () => {
  await requireRole()
  const frameworks = await prisma.copyFramework.findMany({
    where: { published: true },
    select: {
      id: true,
      name: true,
      industryCategory: true,
      suggestedSegmentCount: true,
      imageStylePrompt: true,
      overlayTemplate: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  // 音色标签表：内置 + 运营在 tts.extra.customVoices 里登记的克隆音色。
  // 学员端只拿到**这个框架开放的那几个**——名单之外的 id 连名字都不该露出去。
  const cfg = await getCapabilityConfig('tts')
  const custom = Array.isArray(cfg.extra?.customVoices) ? (cfg.extra.customVoices as unknown[]) : []
  const labels = new Map<string, string>(TTS_VOICES.map((v) => [v.id, v.label]))
  for (const raw of custom) {
    if (!raw || typeof raw !== 'object') continue
    const { id, label } = raw as Record<string, unknown>
    if (!isPlausibleVoiceId(id) || typeof label !== 'string' || !label.trim()) continue
    if (!labels.has(id)) labels.set(id, label.trim())
  }

  return NextResponse.json(frameworks.map(({ overlayTemplate, ...f }) => {
    const v = readFrameworkVoices(overlayTemplate)
    return {
      ...f,
      // 只回名单里的;取不到标签的用 id 兜底显示,不静默丢弃——
      // 丢弃会让运营以为"勾了但没生效",而实际是标签没登记
      voices: v.allowed.map((id) => ({ id, label: labels.get(id) ?? id })),
      ...(v.default ? { defaultVoice: v.default } : {}),
    }
  }))
})
