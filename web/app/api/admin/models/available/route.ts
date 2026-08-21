// 列出某个能力所用端点上可用的模型 id。
//
// 换模型不该靠猜名字：「Model not exist」既可能是名字写错、也可能是这个端点根本不服务
// 该模型（MAAS 专属端点只服务你部署上去的那几个）。列一遍就不用猜了。

import { NextResponse } from 'next/server'
import { dashListModels, getCapabilityConfig, dashCompatBase } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

const CRED_CAPS = ['image', 'llm', 'asr', 'vision'] as const

export const GET = handler(async (req) => {
  await requireRole('operator')
  const cap = new URL(req.url).searchParams.get('credsFrom') ?? 'image'
  if (!(CRED_CAPS as readonly string[]).includes(cap)) throw new HttpError(400, `未知能力：${cap}`)

  const cfg = await getCapabilityConfig(cap as (typeof CRED_CAPS)[number])
  if (!cfg.baseUrl) throw new HttpError(503, `「${cap}」能力没有配置接口地址`)
  if (!cfg.apiKey) throw new HttpError(503, `「${cap}」能力没有配置密钥`)

  try {
    const models = await dashListModels(cfg.baseUrl, cfg.apiKey)
    return NextResponse.json({ endpoint: dashCompatBase(cfg.baseUrl), models })
  } catch (err) {
    throw new HttpError(502, (err as Error).message?.slice(0, 400) ?? '列模型失败')
  }
})
