import { NextResponse } from 'next/server'
import { prisma, enqueueGen } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

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
      variables: variables ?? undefined,
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
