// 试生成一张图。
//
// 为什么需要：换生图模型现在只能靠猜模型名 + 跑一整条任务（几分钟，还要等文案与配音），
// 试错成本高到没法比较。这个接口只做一次生图调用，几秒出图，可以把候选模型挨个试过去，
// 选定了再写进「模型配置」。
//
// **不落库、不改配置**：传进来的 model/凭据只对这一次调用生效。

import { randomUUID } from 'crypto'
import { imageGenerate, getCapabilityConfig, type ImageOverride } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'

/** 可借用凭据的能力。都是同一个百炼账号下的配置，借 base_url + 密钥省得重填 */
const CRED_CAPS = ['image', 'llm', 'asr', 'vision'] as const
type CredCap = (typeof CRED_CAPS)[number]

export const POST = handler(async (req) => {
  const { userId } = await requireRole('operator')
  // 一次试生成就是一次计费调用，限流比反推更紧
  checkRate('image-try', userId, 12)

  const body = (await req.json().catch(() => null)) as {
    prompt?: string; model?: string; size?: string; negativePrompt?: string; credsFrom?: string
  } | null
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw new HttpError(400, '提示词不能为空')

  const credsFrom = (CRED_CAPS as readonly string[]).includes(body?.credsFrom ?? '')
    ? (body!.credsFrom as CredCap)
    : 'image'
  const creds = await getCapabilityConfig(credsFrom)
  if (!creds.enabled) throw new HttpError(503, `「${credsFrom}」能力未开启，借不到它的接口地址与密钥`)
  if (!creds.baseUrl) throw new HttpError(503, `「${credsFrom}」能力没有配置接口地址`)

  const override: ImageOverride = {
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    ...((body?.model ?? '').trim() ? { model: (body!.model as string).trim() } : {}),
  }

  const t0 = Date.now()
  let png: Buffer
  try {
    png = await imageGenerate(
      {
        prompt,
        size: (body?.size ?? '720x960').trim() || '720x960',
        ...(body?.negativePrompt?.trim() ? { negativePrompt: body.negativePrompt.trim() } : {}),
      },
      override,
    )
  } catch (err) {
    // 把模型返回的原文带出来：换模型时最常见的失败是「模型名不对」和「该端点没有这个模型」，
    // 笼统报一句失败会让运营无从下手
    throw new HttpError(502, `试生成失败：${(err as Error).message?.slice(0, 400)}`)
  }

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      // 耗时与实际用的模型放响应头，前端直接显示，省得再开一个 JSON 接口
      'X-Gen-Ms': String(Date.now() - t0),
      'X-Gen-Model': encodeURIComponent(override.model ?? creds.model),
      'X-Gen-Id': randomUUID(),
    },
  })
})
