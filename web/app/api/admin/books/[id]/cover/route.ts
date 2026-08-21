// 书库封面：上传真实封面，或按框架画风生成一张。
//
// 为什么放在书库而不是每条片子现做：书封只跟「这本书」有关，跟这条片子的文案毫无关系。
// 原先每条片子都为每本书重生成一张，9 本书就是 9 次生图调用——一天几千条时这是成本大头，
// 而其中绝大多数是同样那几本常见书。

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma, imageGenerate, buildBookCoverPrompt } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { DATA_DIR } from '@/lib/paths'
import { makeThumb } from '@/lib/thumb'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_BYTES = 10 * 1024 * 1024

async function save(bytes: Buffer, ext: string): Promise<string> {
  const rel = `covers/${randomUUID()}${ext}`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, bytes)
  // 缩略图失败不该拖垮上传本身（文件服务那层对缺失的缩略图会回退原图）
  try { await makeThumb(abs) } catch { /* 忽略 */ }
  return `/api/files/${rel}`
}

/** 上传真实封面。与原工程一致——客户草稿里的快闪图本来就是真实书封。 */
export const POST = handler(async (req, { params }) => {
  const { userId } = await requireRole('operator')
  checkRate('book-cover', userId, 60)

  const book = await prisma.bookLibrary.findUnique({ where: { id: params.id } })
  if (!book) throw new HttpError(404, '书目不存在')

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少封面文件')
  const ext = path.extname(file.name).toLowerCase()
  if (!IMAGE_EXT.has(ext)) throw new HttpError(400, `不支持的图片格式：${file.name}`)
  if (file.size > MAX_BYTES) throw new HttpError(400, `封面过大（${Math.round(file.size / 1048576)}MB），请压到 10MB 以内`)

  const coverUrl = await save(Buffer.from(await file.arrayBuffer()), ext)
  await prisma.bookLibrary.update({ where: { id: book.id }, data: { coverUrl, coverSource: 'upload' } })
  return NextResponse.json({ coverUrl, coverSource: 'upload' })
})

/** 用 AI 生成一张封面底图（无文字，书名由渲染层叠字）。 */
export const PUT = handler(async (req, { params }) => {
  const { userId } = await requireRole('operator')
  checkRate('book-cover-ai', userId, 30)

  const book = await prisma.bookLibrary.findUnique({ where: { id: params.id } })
  if (!book) throw new HttpError(404, '书目不存在')

  const body = (await req.json().catch(() => null)) as { style?: string } | null
  const style = (body?.style ?? '').trim() || undefined
  const { prompt, negativePrompt } = buildBookCoverPrompt({ title: book.title, author: book.author }, style)

  let png: Buffer
  try {
    png = await imageGenerate({ prompt, size: '720x960', negativePrompt })
  } catch (err) {
    throw new HttpError(502, `生成封面失败：${(err as Error).message?.slice(0, 300)}`)
  }
  const coverUrl = await save(png, '.png')
  await prisma.bookLibrary.update({ where: { id: book.id }, data: { coverUrl, coverSource: 'ai' } })
  return NextResponse.json({ coverUrl, coverSource: 'ai' })
})

/** 清掉封面 —— 下次出片会重新生成并回写。 */
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  await prisma.bookLibrary.update({ where: { id: params.id }, data: { coverUrl: null, coverSource: null } })
  return NextResponse.json({ ok: true })
})
