import { getCapabilityConfig, isMockMode } from './config'
import { mockImagePng } from './mock'
import type { ImageOpts } from './types'

export async function imageGenerate(opts: ImageOpts): Promise<Buffer> {
  const cfg = await getCapabilityConfig('image')
  if (isMockMode(cfg)) return mockImagePng()
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, prompt: opts.prompt, size: opts.size ?? '1024x1792', response_format: 'b64_json' }),
  })
  if (!res.ok) throw new Error(`文生图请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (typeof b64 !== 'string') throw new Error('文生图返回格式异常')
  return Buffer.from(b64, 'base64')
}
