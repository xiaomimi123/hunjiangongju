// 导师收款二维码：管理端上传/更换/清除。学员端积分用完的弹窗展示它（经 /api/credits 下发）。
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_BYTES = 10 * 1024 * 1024

export const GET = handler(async () => {
  await requireRole('operator')
  const cfg = await prisma.siteConfig.findUnique({ where: { id: 1 } })
  return NextResponse.json({ qrUrl: cfg?.rechargeQrUrl ?? '' })
})

export const POST = handler(async (req) => {
  await requireRole('operator')
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少二维码图片')
  const ext = path.extname(file.name).toLowerCase()
  if (!IMAGE_EXT.has(ext)) throw new HttpError(400, `不支持的图片格式：${file.name}`)
  if (file.size > MAX_BYTES) throw new HttpError(400, '图片过大，请压到 10MB 以内')

  const rel = `recharge/${randomUUID()}${ext}`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))
  const qrUrl = `/api/files/${rel}`
  await prisma.siteConfig.upsert({ where: { id: 1 }, update: { rechargeQrUrl: qrUrl }, create: { id: 1, rechargeQrUrl: qrUrl } })
  return NextResponse.json({ qrUrl })
})

export const DELETE = handler(async () => {
  await requireRole('operator')
  await prisma.siteConfig.upsert({ where: { id: 1 }, update: { rechargeQrUrl: '' }, create: { id: 1 } })
  return NextResponse.json({ ok: true })
})
