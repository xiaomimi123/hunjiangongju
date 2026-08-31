import { promises as fs } from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { canAccessTask } from '@/lib/taskAccess'
import { DATA_DIR } from '@/lib/paths'

export const GET = handler(async (_req, { params }) => {
  // 任意登录用户可读；下方 ownership 校验保证学员只看自己的任务（他人 404），运营看自己发起的仍可用
  const session = await requireRole()
  const task = await prisma.generationTask.findUnique({
    where: { id: params.id },
    include: {
      framework: { select: { id: true, name: true } },
      // published 供运营详情页反映「发布到成片库」开关状态
      // captionBeats/bookTitle/bookAuthor：剪辑工作台画布用第一段真实文案做预览示例
      // （见 /admin/generate/[id]/studio），复用这条已有接口，不新开一个。
      segments: {
        orderBy: { seqNo: 'asc' },
        select: { seqNo: true, scriptText: true, imageUrl: true, captionBeats: true, bookTitle: true, bookAuthor: true },
      },
      renderTasks: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, videoUrl: true, subtitleUrl: true },
      },
    },
  })
  if (!canAccessTask(task, session)) throw new HttpError(404, '生成任务不存在')

  // 学员不下发完整 variables：里面可能有运营字段（voiceId/assetSource/assetFolder/scriptMode/__bgmId 等）。
  // 学员只需要知道本条选用了哪些真实书目，因此只投影 books 的 title/author。
  if (session.role !== 'operator') {
    const { variables, ...rest } = task
    const rawBooks = variables && typeof variables === 'object' && !Array.isArray(variables)
      ? (variables as Record<string, unknown>).books
      : undefined
    const books = Array.isArray(rawBooks)
      ? rawBooks
          .filter((b): b is { title: string; author?: string } => !!b && typeof b === 'object' && typeof (b as { title?: unknown }).title === 'string')
          .map((b) => ({ title: b.title, author: typeof b.author === 'string' ? b.author : '' }))
      : []
    // captionBeats/bookTitle/bookAuthor 只服务运营端剪辑工作台画布（/admin/generate/[id]/studio 的预览示例）。
    // 学员端在生成期间每 3 秒轮询这条接口（web/app/(student)/works/[id]/page.tsx），
    // 这三个字段对学员完全无用却要计入每次响应体积，因此在这里裁掉，不下发给学员。
    // 数据仍从数据库读出（select 未按角色拆分，代码更简单），只是不发给学员，同样达到省流量的目的。
    const segments = rest.segments.map(({ seqNo, scriptText, imageUrl }) => ({ seqNo, scriptText, imageUrl }))
    return NextResponse.json(books.length > 0 ? { ...rest, segments, books } : { ...rest, segments })
  }

  return NextResponse.json(task)
})

// 删除生成任务：级联删除分镜/渲染任务/质检记录（schema onDelete: Cascade），并清理该任务的素材/成片文件。
export const DELETE = handler(async (_req, { params }) => {
  const session = await requireRole('operator')
  const task = await prisma.generationTask.findUnique({ where: { id: params.id }, select: { id: true, createdBy: true } })
  if (!canAccessTask(task, session)) throw new HttpError(404, '生成任务不存在')

  await prisma.generationTask.delete({ where: { id: params.id } })

  // 清理磁盘文件（best-effort，不因文件缺失而失败）
  await fs.rm(path.join(DATA_DIR, 'gen', params.id), { recursive: true, force: true }).catch(() => {})

  return NextResponse.json({ ok: true })
})
