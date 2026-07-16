import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg'])

// 曲库列表（供编辑页换 BGM 选择）
export const GET = handler(async () => {
  await requireRole('operator')
  const list = await prisma.bgmLibrary.findMany({ orderBy: { id: 'desc' } })
  return NextResponse.json(list)
})

// 上传一首 BGM：multipart file + styleTag → /data/bgm/<uuid>.mp3 → 建库记录
export const POST = handler(async (req) => {
  await requireRole('operator')
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少文件')
  const styleTag = String(form.get('styleTag') ?? '').trim() || null

  const extRaw = path.extname(file.name).toLowerCase()
  const isAudio = AUDIO_EXT.has(extRaw) || file.type.startsWith('audio/')
  if (!isAudio) throw new HttpError(400, '只支持音频文件（mp3 / wav / m4a）')

  const id = randomUUID()
  const ext = AUDIO_EXT.has(extRaw) ? extRaw : '.mp3'
  const rel = `bgm/${id}${ext}`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))

  // 时长探测放在 worker（web 无 ffprobe），此处存 null，不影响使用
  const bgm = await prisma.bgmLibrary.create({
    data: { id, fileUrl: `/api/files/${rel}`, styleTag, durationMs: null },
  })
  return NextResponse.json(bgm)
})
