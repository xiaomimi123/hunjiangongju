import { getCapabilityConfig, isMockMode } from './config'
import { mockLlm } from './mock'
import type { LlmOpts } from './types'

export async function llmComplete(opts: LlmOpts): Promise<string> {
  const cfg = await getCapabilityConfig('llm')
  if (isMockMode(cfg)) return mockLlm(opts.prompt)
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: opts.prompt },
      ],
      max_tokens: opts.maxTokens ?? 2000,
    }),
  })
  if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('LLM 返回格式异常')
  return text
}
