import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { DATA_DIR } from '@/lib/paths'
import { makeThumb } from '@/lib/thumb'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm'])

function kindForExt(ext: string): 'image' | 'video' | null {
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  return null
}

// 素材库列表：?folder= 过滤该文件夹下的素材；始终返回全量去重 folders 清单（供筛选器/生成页下拉使用）。
export const GET = handler(async (req) => {
  await requireRole('operator')
  const folder = new URL(req.url).searchParams.get('folder')?.trim() || undefined
  const [assets, folderRows] = await Promise.all([
    prisma.stockAsset.findMany({
      where: folder ? { folder } : {},
      orderBy: { createdAt: 'desc' },
    }),
    prisma.stockAsset.findMany({
      where: { folder: { not: null } },
      select: { folder: true },
      distinct: ['folder'],
    }),
  ])
  const folders = folderRows.map((r) => r.folder as string).sort()
  return NextResponse.json({ assets, folders })
})

// 批量上传素材：multipart files[](多文件)+ folder?。
// 逐文件校验扩展名，任一非法 → 整单 400（不写入任何文件/记录）；合法才落盘 + 建库记录。
export const POST = handler(async (req) => {
  await requireRole('operator')
  const form = await req.formData()
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) throw new HttpError(400, '请至少选择一个文件')
  const folder = String(form.get('folder') ?? '').trim() || null

  const planned: { file: File; ext: string; kind: 'image' | 'video'; name: string }[] = []
  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase()
    const kind = kindForExt(ext)
    if (!kind) throw new HttpError(400, `不支持的文件类型：${file.name}（仅支持图片 jpg/jpeg/png/webp 或视频 mp4/mov/webm）`)
    const name = path.basename(file.name, path.extname(file.name))
    planned.push({ file, ext, kind, name })
  }

  const assetsDir = path.join(DATA_DIR, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })

  const created = []
  for (const { file, ext, kind, name } of planned) {
    const id = randomUUID()
    const rel = `assets/${id}${ext}`
    const abs = path.join(DATA_DIR, rel)
    await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()))
    // 缩略图是锦上添花，绝不能因它失败拖垮上传主流程：ffmpeg 缺失、损坏输入等一律吞掉只记 warning。
    if (kind === 'image') {
      try {
        await makeThumb(abs)
      } catch (err) {
        console.warn(`[assets] makeThumb 异常(已忽略) ${abs}: ${(err as Error).message}`)
      }
    }
    const asset = await prisma.stockAsset.create({
      data: { id, kind, name, folder, fileUrl: `/api/files/${rel}` },
    })
    created.push(asset)
  }
  return NextResponse.json({ created })
})
