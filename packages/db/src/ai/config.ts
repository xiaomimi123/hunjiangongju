import { prisma } from '../client'
import { decrypt } from '../crypto'

export type Capability = 'llm' | 'image' | 'tts' | 'asr'
export const CAPABILITIES: Capability[] = ['llm', 'image', 'tts', 'asr']

export type ResolvedCapConfig = {
  capability: Capability
  baseUrl: string
  apiKey: string
  model: string
  enabled: boolean
  extra: Record<string, unknown>
}

// 是否强制走 mock（未接通真实服务时用）
export function isMockMode(cfg: { enabled: boolean }): boolean {
  return process.env.AI_MOCK === '1' || !cfg.enabled
}

export async function getCapabilityConfig(cap: Capability): Promise<ResolvedCapConfig> {
  const row = await prisma.aiCapabilityConfig.findUnique({ where: { capability: cap } })
  return {
    capability: cap,
    baseUrl: row?.baseUrl ?? '',
    apiKey: row?.apiKeyEnc ? decrypt(row.apiKeyEnc) : '',
    model: row?.model ?? '',
    enabled: row?.enabled ?? false,
    extra: (row?.extra as Record<string, unknown> | undefined) ?? {},
  }
}
