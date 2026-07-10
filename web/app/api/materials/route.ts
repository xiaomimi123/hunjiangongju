import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'
import { probeDurationMs, makeThumbnail } from '@/lib/ffmpeg'

export const GET = handler(async (req) => {
  await requireRole()
  const tagId = new URL(req.url).searchParams.get('tagId')
  const materials = await prisma.material.findMany({
    where: tagId ? { tags: { some: { tagId } } } : {},
    include: { tags: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(materials)
})

export const POST = handler(async (req) => {
  const session = await requireRole('operator')
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少文件')
  const tagIds: string[] = JSON.parse(String(form.get('tagIds') ?? '[]'))
  if (tagIds.length === 0) throw new HttpError(400, '请至少勾选一个标签')

  const id = randomUUID()
  const ext = (path.extname(file.name) || '.mp4').toLowerCase()
  const base = `materials/${id}`
  const abs = path.join(DATA_DIR, `${base}${ext}`)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  let durationMs = 0
  try {
    durationMs = await probeDurationMs(abs)
    await makeThumbnail(abs, path.join(DATA_DIR, `${base}.jpg`))
  } catch {
    await fs.unlink(abs).catch(() => {})
    throw new HttpError(400, '文件不是可用的视频')
  }

  const material = await prisma.material.create({
    data: {
      id,
      fileUrl: `/api/files/${base}${ext}`,
      thumbnailUrl: `/api/files/${base}.jpg`,
      durationMs,
      uploadedBy: session.userId,
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
    include: { tags: true },
  })
  return NextResponse.json(material)
})
