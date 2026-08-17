import { getCapabilityConfig, isMockMode } from './config'
import { mockLlm } from './mock'
import type { LlmOpts } from './types'

type LlmBody = {
  model: string
  messages: { role: string; content: string }[]
  max_tokens: number
  temperature?: number
  enable_search?: boolean
}

/** 组装 /chat/completions 请求体。temperature/enable_search 仅在显式给出时才带上——
 *  缺省一律不传，保持与改动前逐字节一致的请求体（既有生成行为不受影响）。 */
export function buildLlmBody(cfg: { model: string }, opts: LlmOpts): LlmBody {
  return {
    model: cfg.model,
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: opts.prompt },
    ],
    max_tokens: opts.maxTokens ?? 2000,
    ...(typeof opts.temperature === 'number' ? { temperature: opts.temperature } : {}),
    ...(opts.enableSearch === true ? { enable_search: true } : {}),
  }
}

export async function llmComplete(opts: LlmOpts): Promise<string> {
  const cfg = await getCapabilityConfig('llm')
  if (isMockMode(cfg)) return mockLlm(opts.prompt)
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(buildLlmBody(cfg, opts)),
  })
  if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('LLM 返回格式异常')
  return text
}
