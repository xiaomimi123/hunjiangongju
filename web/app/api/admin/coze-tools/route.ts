// 扣子工作流工具箱：工具列表 / 新建。
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { validateInputs, validatePriceCredits, validateName, validateWorkflowId, validateVideoUrl } from '@/lib/cozeToolAdmin'

export const GET = handler(async () => {
  await requireRole('operator')
  const tools = await prisma.cozeTool.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  })
  return NextResponse.json({ tools })
})

export const POST = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })

  const name = validateName(body.name)
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const workflowId = validateWorkflowId(body.workflowId)
  const inputs = validateInputs(body.inputs)
  const priceCredits = validatePriceCredits(body.priceCredits ?? 1)
  const enabled = body.enabled === true
  const sortOrder = Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0
  const demoVideoUrl = validateVideoUrl(body.demoVideoUrl, '演示视频地址')
  const tutorialVideoUrl = validateVideoUrl(body.tutorialVideoUrl, '教学视频地址')

  const tool = await prisma.cozeTool.create({
    data: { name, description, workflowId, inputs, priceCredits, enabled, sortOrder, demoVideoUrl, tutorialVideoUrl },
  })
  return NextResponse.json(tool)
})
