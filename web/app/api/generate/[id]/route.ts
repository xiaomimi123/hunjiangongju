import { promises as fs } from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

export const GET = handler(async (_req, { params }) => {
  // 任意登录用户可读；下方 ownership 校验保证学员只看自己的任务（他人 404），运营看自己发起的仍可用
  const session = await requireRole()
  const task = await prisma.generationTask.findUnique({
    where: { id: params.id },
    include: {
      framework: { select: { id: true, name: true } },
      // published 供运营详情页反映「发布到成片库」开关状态
      segments: { orderBy: { seqNo: 'asc' }, select: { seqNo: true, scriptText: true, imageUrl: true } },
      renderTasks: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, videoUrl: true, subtitleUrl: true },
      },
    },
  })
  if (!task || (task.createdBy && task.createdBy !== session.userId)) throw new HttpError(404, '生成任务不存在')
  return NextResponse.json(task)
})

// 删除生成任务：级联删除分镜/渲染任务/质检记录（schema onDelete: Cascade），并清理该任务的素材/成片文件。
export const DELETE = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id }, select: { id: true, createdBy: true } })
  if (!task || (task.createdBy && task.createdBy !== session.userId)) throw new HttpError(404, '生成任务不存在')

  await prisma.generationTask.delete({ where: { id: params.id } })

  // 清理磁盘文件（best-effort，不因文件缺失而失败）
  await fs.rm(path.join(DATA_DIR, 'gen', params.id), { recursive: true, force: true }).catch(() => {})

  return NextResponse.json({ ok: true })
})
