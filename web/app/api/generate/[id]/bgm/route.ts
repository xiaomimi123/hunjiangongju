import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 选定本任务合成时使用的 BGM。generationTask 无 bgmId 字段，
// P1 存入 variables.__bgmId（保留键），render-visuals 建 RenderTask 时读取写入 RenderTask.bgmId。
// body: { bgmId: string | null }（null 表示清除，无 BGM）
export const POST = handler(async (req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id } })
  if (!task || task.createdBy !== session.userId) throw new HttpError(404, '生成任务不存在')

  const body = (await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })) as { bgmId?: string | null }

  let bgmId: string | null = null
  if (body.bgmId) {
    const bgm = await prisma.bgmLibrary.findUnique({ where: { id: body.bgmId } })
    if (!bgm) throw new HttpError(404, 'BGM 不存在')
    bgmId = bgm.id
  }

  const vars = (task.variables && typeof task.variables === 'object' && !Array.isArray(task.variables)
    ? { ...(task.variables as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  if (bgmId) vars.__bgmId = bgmId
  else delete vars.__bgmId

  await prisma.generationTask.update({ where: { id: task.id }, data: { variables: vars as Prisma.InputJsonValue } })
  return NextResponse.json({ ok: true, bgmId })
})
