import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, sanitizeParamsOverride, mergeTemplateParamsRaw, parseTemplateParams } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 框架级剪辑参数：直接改 overlayTemplate.__templateParams。
//
// 与任务级（/api/generate/[id]/params）的区别：那边只影响一条片子，这边影响
// **以后所有用这个框架生成的片子**，已经生成的不受影响（它们的参数在渲染时才读，
// 但已渲完的不会自己重渲）。
//
// 白名单共用 sanitizeParamsOverride：两处能调的字段必须完全一致，否则会出现
// 「工作台里调得了、框架里调不了」这种说不清的差别。

function readOverlay(overlayTemplate: unknown): Record<string, unknown> {
  return overlayTemplate && typeof overlayTemplate === 'object' && !Array.isArray(overlayTemplate)
    ? { ...(overlayTemplate as Record<string, unknown>) }
    : {}
}

export const GET = handler(async (_req, { params }) => {
  await requireRole('operator')
  const fw = await prisma.copyFramework.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, overlayTemplate: true },
  })
  if (!fw) throw new HttpError(404, '框架不存在')
  const raw = readOverlay(fw.overlayTemplate).__templateParams
  return NextResponse.json({
    name: fw.name,
    effective: parseTemplateParams(raw),
    // 有没有从剪映草稿解析过：没有的话各项都是代码默认值，界面上要说清楚
    hasDraftParams: !!raw,
  })
})

/** 局部更新：只写请求里给到的字段，其余保持不变 */
export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const fw = await prisma.copyFramework.findUnique({
    where: { id: params.id },
    select: { id: true, overlayTemplate: true },
  })
  if (!fw) throw new HttpError(404, '框架不存在')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const clean = sanitizeParamsOverride(body)
  if (!clean) throw new HttpError(400, '没有可保存的参数（字段名不对，或值都不合法）')

  const ot = readOverlay(fw.overlayTemplate)
  ot.__templateParams = mergeTemplateParamsRaw(ot.__templateParams, clean)
  await prisma.copyFramework.update({
    where: { id: fw.id },
    data: { overlayTemplate: ot as Prisma.InputJsonValue },
  })
  return NextResponse.json({ ok: true, params: ot.__templateParams })
})
