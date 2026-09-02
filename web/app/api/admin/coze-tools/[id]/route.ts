// 单个扣子工具：编辑（含上下架）/ 删除。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { validateInputs, validatePriceCredits, validateName, validateWorkflowId } from '@/lib/cozeToolAdmin'

// 局部更新：传了哪个字段才校验/写哪个字段，未传的保持原样。
export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const tool = await prisma.cozeTool.findUnique({ where: { id: params.id } })
  if (!tool) throw new HttpError(404, '工具不存在')

  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })

  const data: Record<string, unknown> = {}
  if ('name' in body) data.name = validateName(body.name)
  if ('description' in body) data.description = typeof body.description === 'string' ? body.description.trim() : ''
  if ('workflowId' in body) data.workflowId = validateWorkflowId(body.workflowId)
  if ('inputs' in body) data.inputs = validateInputs(body.inputs)
  if ('priceCredits' in body) data.priceCredits = validatePriceCredits(body.priceCredits)
  if ('enabled' in body) data.enabled = body.enabled === true
  if ('sortOrder' in body) {
    if (!Number.isInteger(body.sortOrder)) throw new HttpError(400, 'sortOrder 必须是整数')
    data.sortOrder = body.sortOrder
  }

  const updated = await prisma.cozeTool.update({ where: { id: tool.id }, data })
  return NextResponse.json(updated)
})

// 删除：有运行记录的工具不物理删（记录里 toolId 外键悬空会让历史记录页崩），
// 改为下架（enabled=false），与素材/BGM 被引用时跳过删除同思路。
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const tool = await prisma.cozeTool.findUnique({ where: { id: params.id } })
  if (!tool) throw new HttpError(404, '工具不存在')

  const runCount = await prisma.cozeToolRun.count({ where: { toolId: tool.id } })
  if (runCount > 0) {
    await prisma.cozeTool.update({ where: { id: tool.id }, data: { enabled: false } })
    return NextResponse.json({ ok: true, disabled: true, hint: '该工具已有运行记录，已改为下架' })
  }

  await prisma.cozeTool.delete({ where: { id: tool.id } })
  return NextResponse.json({ ok: true })
})
