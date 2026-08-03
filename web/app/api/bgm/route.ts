import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg'])

function isAudioFile(file: File, extRaw: string): boolean {
  return AUDIO_EXT.has(extRaw) || file.type.startsWith('audio/')
}

// 曲库列表（供编辑页换 BGM 选择）
export const GET = handler(async () => {
  await requireRole('operator')
  const list = await prisma.bgmLibrary.findMany({ orderBy: { id: 'desc' } })
  return NextResponse.json(list)
})

// 上传 BGM：multipart files[]（多文件，批量）+ folder? + styleTag?。
// 为兼容旧客户端/测试，files 为空时回退单文件字段 file，且响应形状与旧版一致（单条记录对象，而非数组）。
// 批量场景：逐文件校验扩展名，任一非法 → 整单 400（不写入任何文件/记录）；合法才落盘 + 建库记录，name 取去扩展名文件名。
export const POST = handler(async (req) => {
  await requireRole('operator')
  const form = await req.formData()
  const styleTag = String(form.get('styleTag') ?? '').trim() || null
  const folder = String(form.get('folder') ?? '').trim() || null

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length > 0) {
    const planned: { file: File; ext: string; name: string }[] = []
    for (const file of files) {
      const extRaw = path.extname(file.name).toLowerCase()
      if (!isAudioFile(file, extRaw)) throw new HttpError(400, `只支持音频文件（mp3 / wav / m4a）：${file.name}`)
      const ext = AUDIO_EXT.has(extRaw) ? extRaw : '.mp3'
      const name = path.basename(file.name, path.extname(file.name))
      planned.push({ file, ext, name })
    }

    const bgmDir = path.join(DATA_DIR, 'bgm')
    await fs.mkdir(bgmDir, { recursive: true })

    const created = []
    for (const { file, ext, name } of planned) {
      const id = randomUUID()
      const rel = `bgm/${id}${ext}`
      const abs = path.join(DATA_DIR, rel)
      await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))
      // 时长探测放在 worker（web 无 ffprobe），此处存 null，不影响使用
      const bgm = await prisma.bgmLibrary.create({
        data: { id, fileUrl: `/api/files/${rel}`, styleTag, durationMs: null, name, folder },
      })
      created.push(bgm)
    }
    return NextResponse.json(created)
  }

  // 兼容旧版单文件字段
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, '缺少文件')
  const extRaw = path.extname(file.name).toLowerCase()
  if (!isAudioFile(file, extRaw)) throw new HttpError(400, '只支持音频文件（mp3 / wav / m4a）')

  const id = randomUUID()
  const ext = AUDIO_EXT.has(extRaw) ? extRaw : '.mp3'
  const rel = `bgm/${id}${ext}`
  const abs = path.join(DATA_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))
  const name = path.basename(file.name, path.extname(file.name))

  const bgm = await prisma.bgmLibrary.create({
    data: { id, fileUrl: `/api/files/${rel}`, styleTag, durationMs: null, name, folder },
  })
  return NextResponse.json(bgm)
})
