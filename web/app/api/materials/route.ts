import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'
import { probeDurationMs, makeThumbnail, makeImageThumbnail } from '@/lib/ffmpeg'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'])

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

  const extRaw = path.extname(file.name).toLowerCase()
  const isImage = IMAGE_EXT.has(extRaw) || file.type.startsWith('image/')
  const isVideo = VIDEO_EXT.has(extRaw) || file.type.startsWith('video/')
  if (!isImage && !isVideo) throw new HttpError(400, '只支持视频或图片文件')
  const kind = isVideo ? 'video' : 'image'

  const id = randomUUID()
  const ext = extRaw || (isVideo ? '.mp4' : '.jpg')
  const base = `materials/${id}`
  const abs = path.join(DATA_DIR, `${base}${ext}`)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  // 校验文件确实可用：视频取时长+抽帧，图片直接缩放；任一失败即判为无效文件
  let durationMs: number | null = null
  try {
    if (kind === 'video') {
      durationMs = await probeDurationMs(abs)
      await makeThumbnail(abs, path.join(DATA_DIR, `${base}.jpg`))
    } else {
      await makeImageThumbnail(abs, path.join(DATA_DIR, `${base}.jpg`))
    }
  } catch {
    await fs.unlink(abs).catch(() => {})
    throw new HttpError(400, kind === 'video' ? '文件不是可用的视频' : '文件不是可用的图片')
  }

  const material = await prisma.material.create({
    data: {
      id,
      kind,
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
