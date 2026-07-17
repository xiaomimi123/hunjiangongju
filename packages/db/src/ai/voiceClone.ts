import { prisma } from '../client'
import { getCapabilityConfig, isMockMode } from './config'
import { dashPost, dashVoiceEnrollEndpoint } from './dashscope'
import type { ClonedVoice } from '@prisma/client'

// 声音复刻建声请求/响应结构核对自官方文档：
//   用户指南 https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide
//   HTTP API 参考 https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api
//   Python SDK 参考 https://help.aliyun.com/zh/model-studio/voice-clone-python-sdk
// 请求体：{ model: 'voice-enrollment', input: { action: 'create_voice', target_model, prefix, url, language_hints? } }
// 响应体：{ output: { voice_id: '<target_model>-<prefix>-xxxxxx' }, usage, request_id }
// prefix 要求字母数字、最长 10 字符，故对传入的 name 做清洗截断。

// 纯解析函数：从建声接口返回中提取 voice_id。
export function parseEnrollResult(raw: any): { voiceId: string } {
  const voiceId = raw?.output?.voice_id
  if (typeof voiceId !== 'string' || !voiceId) {
    throw new Error(`声音复刻建声返回格式异常: ${JSON.stringify(raw).slice(0, 200)}`)
  }
  return { voiceId }
}

// prefix 只允许字母数字，最长 10 字符（文档约束）；中文名等做兜底替换。
function toPrefix(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)
  return cleaned || `v${Date.now().toString(36)}`.slice(0, 10)
}

export async function enrollVoice(sampleUrl: string, name: string): Promise<{ voiceId: string }> {
  const cfg = await getCapabilityConfig('tts')

  let voiceId: string
  if (isMockMode(cfg)) {
    // mock 模式：不发起真实网络请求，返回确定性 fake voiceId
    voiceId = `mock-voice-${toPrefix(name)}`
  } else {
    const targetModel = (cfg.extra?.targetModel as string) || cfg.model || 'cosyvoice-v3-plus'
    const raw = await dashPost(
      cfg.baseUrl,
      cfg.apiKey,
      {
        model: 'voice-enrollment',
        input: {
          action: 'create_voice',
          target_model: targetModel,
          prefix: toPrefix(name),
          url: sampleUrl,
        },
      },
      dashVoiceEnrollEndpoint(cfg.baseUrl),
    )
    voiceId = parseEnrollResult(raw).voiceId
  }

  await prisma.clonedVoice.create({
    data: { voiceId, name, sampleAssetUrl: sampleUrl, provider: 'dashscope' },
  })
  return { voiceId }
}

export async function listVoices(): Promise<ClonedVoice[]> {
  return prisma.clonedVoice.findMany({ orderBy: { createdAt: 'desc' } })
}
