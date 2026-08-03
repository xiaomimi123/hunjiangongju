import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

// 改名 / 改文件夹（行内编辑）。folder 传空字符串视为「移出文件夹」。
export const PATCH = handler(async (req, { params }) => {
  await requireRole('operator')
  const asset = await prisma.stockAsset.findUnique({ where: { id: params.id } })
  if (!asset) throw new HttpError(404, '素材不存在')
  const body = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  const data: { name?: string; folder?: string | null } = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw new HttpError(400, '名称不能为空')
    data.name = name
  }
  if ('folder' in body) {
    const folder = typeof body.folder === 'string' ? body.folder.trim() : ''
    data.folder = folder || null
  }
  const updated = await prisma.stockAsset.update({ where: { id: asset.id }, data })
  return NextResponse.json(updated)
})

// 删除素材：无 FK 引用，直接删记录 + 尽力删文件。
export const DELETE = handler(async (_req, { params }) => {
  await requireRole('operator')
  const asset = await prisma.stockAsset.findUnique({ where: { id: params.id } })
  if (!asset) throw new HttpError(404, '素材不存在')
  await prisma.stockAsset.delete({ where: { id: asset.id } })
  const rel = asset.fileUrl.replace(/^\/api\/files\//, '')
  await fs.unlink(path.join(DATA_DIR, rel)).catch(() => {})
  return NextResponse.json({ ok: true })
})
