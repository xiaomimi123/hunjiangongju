// 参考图 → 画风提示词（反推）。
//
// 用途：运营在框架库里给「整体画风」或「第 N 张图的画风」找不到合适的预设时，
// 直接丢一张参考图上来，由 vision 模型反推出可直接用于文生图的画风提示词。
//
// 为什么要先落盘再签名：百炼是**它自己去拉图**，不接受本机路径，也不走我们的会话鉴权。
// 与拆解流程（extractStyle.ts）同一套做法：写进 DATA_DIR → publicAssetUrl 签名短时效 URL。

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { describeStyleForPrompt, publicAssetUrl, getCapabilityConfig } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { DATA_DIR } from '@/lib/paths'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
/** 参考图上限。vision 模型对大图会先压缩，传原图只是白白占带宽 */
const MAX_BYTES = 10 * 1024 * 1024

export const POST = handler(async (req) => {
  const { userId } = await requireRole('operator')
  // 反推一次是一次 vision 调用，要限流；否则连点几十下就是几十次计费调用
  checkRate('style-from-image', userId, 20)

  // ★ 能力没配时必须**明说**，不能返回兜底串。
  // vision 没有配置行时 getCapabilityConfig 返回 enabled:false，describeStyleForPrompt
  // 会直接返回 mock 值、一次网络请求都不发。运营看到的是一句像模像样的
  // 「厚涂油画质感,浓郁色彩…」，完全不知道模型压根没读图——线上就是这么踩的。
  // AI_MOCK=1 是本地/测试的显式开关，那种情况放行。
  if (process.env.AI_MOCK !== '1') {
    const cap = await getCapabilityConfig('vision')
    if (!cap.enabled) {
      throw new HttpError(503, 'vision 能力未开启：请到「模型配置」页配置 vision（如 qwen-vl-max）并启用后重试')
    }
    if (!cap.baseUrl || !cap.model) {
      throw new HttpError(503, 'vision 能力配置不完整：缺少 base_url 或 model')
    }
    if (!process.env.PUBLIC_BASE_URL) {
      throw new HttpError(503, 'PUBLIC_BASE_URL 未配置：百炼需要用公网地址来拉取参考图')
    }
  }

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少参考图文件')
  const ext = path.extname(file.name).toLowerCase()
  if (!IMAGE_EXT.has(ext)) throw new HttpError(400, `不支持的图片格式：${file.name}`)
  if (file.size > MAX_BYTES) throw new HttpError(400, `参考图过大（${Math.round(file.size / 1048576)}MB），请压到 10MB 以内`)

  // 存在 refs/ 下而不是 assets/：这不是可用于出片的素材，只是反推用的临时参考，
  // 混进 assets/ 会被素材库列出来、甚至被正片槽位抽中。
  const rel = `refs/${randomUUID()}${ext}`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  let stylePrompt: string
  try {
    stylePrompt = await describeStyleForPrompt([publicAssetUrl(rel)])
  } catch (err) {
    // 反推失败要说清楚是哪一步：PUBLIC_BASE_URL 没配、vision 能力没开、模型名写错，
    // 三种都会走到这里，笼统报「失败」会让运营无从下手。
    throw new HttpError(502, `反推画风失败：${(err as Error).message?.slice(0, 200)}`)
  }

  return NextResponse.json({ stylePrompt, refUrl: `/api/files/${rel}` })
})
