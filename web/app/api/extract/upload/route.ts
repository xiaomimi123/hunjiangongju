import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma, enqueueGen } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'])

export const POST = handler(async (req) => {
  const session = await requireRole('operator')
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少文件')

  const extRaw = path.extname(file.name).toLowerCase()
  const isVideo = file.type.startsWith('video/') || VIDEO_EXT.has(extRaw)
  if (!isVideo) throw new HttpError(400, '只支持视频文件')

  const id = randomUUID()
  const rel = `source/${id}.mp4`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  const source = await prisma.sourceVideo.create({
    data: {
      douyinShareUrl: '(manual-upload)',
      videoFileUrl: `/api/files/${rel}`,
      status: 'DOWNLOADING',
      createdBy: session.userId,
    },
  })

  // 手动上传跳过 download-douyin，直接进 ASR 转写
  await enqueueGen('transcribe', { sourceVideoId: source.id })

  return NextResponse.json({ id: source.id })
})
