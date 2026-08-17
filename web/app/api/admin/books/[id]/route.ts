import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma, normalizeTitle } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 行内改书名/作者/主题/要点：这是运营纠错 AI 幻觉书目的主要入口（错作者/查无此书），
// 各字段独立可选传入；改到与另一行撞 (title, author) 唯一约束 → 409。
export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const book = await prisma.bookLibrary.findUnique({ where: { id: params.id } })
  if (!book) throw new HttpError(404, '书目不存在')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const data: { title?: string; author?: string; theme?: string | null; points?: string | null } = {}
  if ('title' in body) {
    const title = typeof body.title === 'string' ? normalizeTitle(body.title) : ''
    if (!title) throw new HttpError(400, '书名不能为空')
    data.title = title
  }
  if ('author' in body) {
    const author = typeof body.author === 'string' ? body.author.trim() : ''
    if (!author) throw new HttpError(400, '作者不能为空')
    data.author = author
  }
  if ('theme' in body) {
    const theme = typeof body.theme === 'string' ? body.theme.trim() : ''
    data.theme = theme || null
  }
  if ('points' in body) {
    const points = typeof body.points === 'string' ? body.points.trim() : ''
    data.points = points || null
  }

  try {
    const updated = await prisma.bookLibrary.update({ where: { id: book.id }, data })
    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, '该书名与作者已存在')
    }
    throw err
  }
})

// 删除书目：确认查无此书/彻底建错时，运营直接删行，避免这条记录被后续 AI 选书复用。
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const book = await prisma.bookLibrary.findUnique({ where: { id: params.id } })
  if (!book) throw new HttpError(404, '书目不存在')
  await prisma.bookLibrary.delete({ where: { id: book.id } })
  return NextResponse.json({ ok: true })
})
