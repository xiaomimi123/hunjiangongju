// AI 实拍生图的生图服务客户端（apimart 风格：POST /v1/images/generations 提交返 task_id，
// GET /v1/tasks/{id} 轮询）。已实测（2026-09-16）：
// - 图片输入走 JSON 体 image 数组（data:image/...;base64,xxx），支持多张（原图+参考图角色分工有效）
// - /v1/images/edits 只服务 Grok 模型，不走那个端点
// - 完成态 result.images[0].url[0] 是约 24 小时过期的临时 URL，调用方必须转存
// - size 支持 '3:4' / '4:5' 这类比例字符串，resolution '1k'/'2k'
import { getCapabilityConfig, isMockMode } from './config'

export type PhotoGenOpts = {
  prompt: string
  /** data URI 列表（data:image/jpeg;base64,…），图片1 在前 */
  images: string[]
  size: string
  resolution?: string
}

const POLL_INTERVAL_MS = 5_000
const TOTAL_TIMEOUT_MS = 5 * 60_000

// 1x1 透明 PNG：mock 模式的占位产物（本能力自带 mock，不借道其它能力）
const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function base(u: string): string {
  return u.replace(/\/$/, '')
}

async function submit(cfg: { baseUrl: string; apiKey: string; model: string }, opts: PhotoGenOpts, extra: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${base(cfg.baseUrl)}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model || 'gpt-image-2',
      prompt: opts.prompt,
      n: 1,
      size: opts.size,
      resolution: opts.resolution ?? (typeof extra.resolution === 'string' ? extra.resolution : '1k'),
      image: opts.images,
    }),
  })
  if (!res.ok) throw new Error(`生图提交失败 ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  const data = (await res.json()) as { data?: { task_id?: string }[] }
  const taskId = data?.data?.[0]?.task_id
  if (!taskId) throw new Error(`生图提交响应缺少 task_id: ${JSON.stringify(data).slice(0, 200)}`)
  return taskId
}

export function parsePhotoTask(data: unknown): { status: string; urls: string[]; error?: string } {
  const d = (data as { data?: Record<string, unknown> })?.data ?? {}
  const status = typeof d.status === 'string' ? d.status : 'unknown'
  const urls: string[] = []
  const result = d.result as { images?: { url?: string[] }[] } | undefined
  for (const img of result?.images ?? []) {
    for (const u of img.url ?? []) if (typeof u === 'string') urls.push(u)
  }
  const error = typeof d.error === 'string' ? d.error : undefined
  return { status, urls, error }
}

async function poll(cfg: { baseUrl: string; apiKey: string }, taskId: string): Promise<string[]> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS
  for (;;) {
    const res = await fetch(`${base(cfg.baseUrl)}/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    })
    if (!res.ok) throw new Error(`生图查询失败 ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
    const parsed = parsePhotoTask(await res.json())
    if (parsed.status === 'completed') {
      if (parsed.urls.length === 0) throw new Error('生图完成但没有返回图片 URL')
      return parsed.urls
    }
    // 进行中状态白名单：api.apimart.ai 实测返回 submitted/processing，
    // 国内直连入口 apib.ai 实测还会返回 pending（2026-09-16 线上踩坑：pending 被误判为失败态）。
    // queued/waiting/running 一并收进来，防下一个别名再炸。
    if (!['processing', 'submitted', 'pending', 'queued', 'waiting', 'running'].includes(parsed.status)) {
      throw new Error(`生图任务失败（${parsed.status}）${parsed.error ? `: ${parsed.error.slice(0, 200)}` : ''}`)
    }
    if (Date.now() > deadline) throw new Error(`生图任务超时（${TOTAL_TIMEOUT_MS / 1000}s）`)
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

/**
 * 提交一次生图并等到完成，返回远程图片 URL 列表（临时 URL，调用方转存）。
 * mock 模式返回 'mock:' 前缀的占位标记，配套的下载函数会认出它并给占位字节。
 */
export async function photoGenerate(opts: PhotoGenOpts): Promise<string[]> {
  const cfg = await getCapabilityConfig('photo')
  if (isMockMode(cfg)) return ['mock:photo.png']
  if (!cfg.baseUrl) throw new Error('「实拍生图」能力没有配置接口地址，请到后台「模型配置」填写')
  if (!cfg.apiKey) throw new Error('「实拍生图」能力没有配置密钥，请到后台「模型配置」填写')
  const taskId = await submit(cfg, opts, cfg.extra)
  return poll(cfg, taskId)
}

/** mock URL 的占位下载：真实 URL 由调用方自己 fetch 转存 */
export function isMockPhotoUrl(url: string): boolean {
  return url.startsWith('mock:')
}
export function mockPhotoBytes(): Buffer {
  return Buffer.from(MOCK_PNG)
}
