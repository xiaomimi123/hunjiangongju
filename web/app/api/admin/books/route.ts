import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma, normalizeTitle } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

// 书库列表：?theme= 过滤该主题下的书目；始终返回全量去重 themes 清单（供筛选器下拉使用）。
export const GET = handler(async (req) => {
  await requireRole('operator')
  const theme = new URL(req.url).searchParams.get('theme')?.trim() || undefined
  const [books, themeRows] = await Promise.all([
    prisma.bookLibrary.findMany({
      where: theme ? { theme } : {},
      orderBy: { createdAt: 'desc' },
    }),
    prisma.bookLibrary.findMany({
      where: { theme: { not: null } },
      select: { theme: true },
      distinct: ['theme'],
    }),
  ])
  const themes = themeRows.map((r) => r.theme as string).sort()
  return NextResponse.json({ books, themes })
})

// 人工新增书目：source 固定为 manual（与 AI 沉淀的 ai 区分）。
// title/author 必填；重复 (title, author) → 409，而不是像 upsertBook 那样静默返回既有行——
// 运营在这个页面新增，是想确认建了一条新记录，撞重需要明确提示去改/查既有行。
export const POST = handler(async (req) => {
  await requireRole('operator')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const title = typeof body.title === 'string' ? normalizeTitle(body.title) : ''
  const author = typeof body.author === 'string' ? body.author.trim() : ''
  if (!title || !author) throw new HttpError(400, '书名与作者不能为空')
  const theme = typeof body.theme === 'string' ? body.theme.trim() || null : null
  const points = typeof body.points === 'string' ? body.points.trim() || null : null

  try {
    const book = await prisma.bookLibrary.create({
      data: { title, author, theme, points, source: 'manual' },
    })
    return NextResponse.json(book)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, '该书名与作者已存在')
    }
    throw err
  }
})
