import { NextResponse } from 'next/server'
import { prisma, creditsToCc } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { deleteFrameworkDeep } from '@/lib/deleteCascade'

export const GET = handler(async (_req, { params }) => {
  await requireRole('operator')
  const fw = await prisma.copyFramework.findUnique({ where: { id: params.id } })
  if (!fw) throw new HttpError(404, '框架不存在')
  return NextResponse.json(fw)
})

export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const fw = await prisma.copyFramework.findUnique({ where: { id: params.id } })
  if (!fw) throw new HttpError(404, '框架不存在')
  const b = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const data: Record<string, unknown> = {}
  if (typeof b.name === 'string') data.name = b.name
  if (typeof b.frameworkText === 'string') {
    if (!b.frameworkText.trim()) throw new HttpError(400, '框架文案不能为空')
    data.frameworkText = b.frameworkText
  }
  if (typeof b.industryCategory === 'string') data.industryCategory = b.industryCategory
  if (typeof b.imageStylePrompt === 'string') data.imageStylePrompt = b.imageStylePrompt
  if (b.overlayTemplate !== undefined) data.overlayTemplate = b.overlayTemplate
  if (typeof b.renderTemplate === 'string') data.renderTemplate = b.renderTemplate
  if (b.maxLines !== undefined) data.maxLines = b.maxLines === null ? null : Number(b.maxLines)
  if (b.maxTotalChars !== undefined) data.maxTotalChars = b.maxTotalChars === null ? null : Number(b.maxTotalChars)
  if (b.suggestedSegmentCount !== undefined) data.suggestedSegmentCount = b.suggestedSegmentCount === null ? null : Number(b.suggestedSegmentCount)
  if (typeof b.published === 'boolean') data.published = b.published
  // 框架级生成价格（积分，可两位小数）：null/空 = 用全局视频单价
  if ('priceCredits' in b) {
    if (b.priceCredits === null || b.priceCredits === '') {
      data.priceCc = null
    } else {
      const cc = creditsToCc(b.priceCredits)
      if (cc === null) throw new HttpError(400, '生成价格必须是 0-1000000 的数字，最多两位小数')
      data.priceCc = cc
    }
  }
  const updated = await prisma.copyFramework.update({ where: { id: params.id }, data })
  return NextResponse.json(updated)
})

// 删除框架：连带删除其下的生成任务及成片文件。
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const fw = await prisma.copyFramework.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!fw) throw new HttpError(404, '框架不存在')
  const taskCount = await prisma.generationTask.count({ where: { frameworkId: params.id } })
  await deleteFrameworkDeep(params.id)
  return NextResponse.json({ ok: true, deletedTasks: taskCount })
})
