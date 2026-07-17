import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, enqueueGen } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

type BookInput = { title: string; author?: string; points?: string }

// 手填书单模式下，服务端不信任客户端已 trim/校验过的书单，重新做一遍最小校验与清洗。
function normalizeBooks(input: unknown): BookInput[] {
  if (!Array.isArray(input)) throw new HttpError(400, '书单格式错误，应为数组')
  const books: BookInput[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, '书单格式错误')
    const title = typeof (raw as Record<string, unknown>).title === 'string' ? (raw as Record<string, unknown>).title as string : ''
    const t = title.trim()
    if (!t) continue // 空书名的行直接跳过（前端允许留空行占位）
    const authorRaw = (raw as Record<string, unknown>).author
    const pointsRaw = (raw as Record<string, unknown>).points
    const author = typeof authorRaw === 'string' && authorRaw.trim() ? authorRaw.trim() : undefined
    const points = typeof pointsRaw === 'string' && pointsRaw.trim() ? pointsRaw.trim() : undefined
    books.push({ title: t, ...(author ? { author } : {}), ...(points ? { points } : {}) })
  }
  if (books.length === 0) throw new HttpError(400, '书单模式下至少需要一本有效书名')
  return books
}

// 校验/清洗前端传来的 variables：手填书单模式下 books 需为合法数组，其余字段原样透传。
function normalizeVariables(variables: unknown): Record<string, unknown> | undefined {
  if (variables === undefined || variables === null) return undefined
  if (typeof variables !== 'object' || Array.isArray(variables)) throw new HttpError(400, '变量格式错误')
  const v = { ...(variables as Record<string, unknown>) }
  if ('books' in v) {
    v.books = normalizeBooks(v.books)
  }
  return v
}

export const POST = handler(async (req) => {
  const s = await requireRole()
  const { frameworkId, subject, variables } = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  if (!frameworkId || typeof frameworkId !== 'string') throw new HttpError(400, '请选择框架')
  if (!subject || typeof subject !== 'string' || !subject.trim()) throw new HttpError(400, '选题不能为空')
  const fw = await prisma.copyFramework.findUnique({ where: { id: frameworkId } })
  if (!fw) throw new HttpError(400, '框架不存在')
  // 学员（非运营）：只能用已发布框架，自动串联渲染；运营：保留手工门禁
  let autoRender = false
  if (s.role !== 'operator') {
    if (!fw.published) throw new HttpError(403, '该框架未发布')
    autoRender = true
  }
  const task = await prisma.generationTask.create({
    data: {
      frameworkId,
      subject: subject.trim(),
      variables: (normalizeVariables(variables) as Prisma.InputJsonValue | undefined) ?? undefined,
      status: 'SCRIPT_GENERATING',
      createdBy: s.userId,
      autoRender,
    },
  })
  await enqueueGen('generate-script', { genTaskId: task.id })
  return NextResponse.json({ id: task.id })
})

export const GET = handler(async () => {
  const s = await requireRole()
  const tasks = await prisma.generationTask.findMany({
    where: { createdBy: s.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, subject: true, status: true, createdAt: true, updatedAt: true,
      framework: { select: { name: true } },
      // 最新合成任务状态：autoRender 任务的 generationTask.status 停在 VISUAL_RENDERING，
      // 真实进度（EXPORTED/QC_FAILED 等）在 RenderTask 上，列表据此归类「已完成/失败」。
      renderTasks: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
    },
  })
  return NextResponse.json(tasks)
})
