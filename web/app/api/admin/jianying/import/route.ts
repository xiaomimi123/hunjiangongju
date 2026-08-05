import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import type { Prisma } from '@prisma/client'
import { prisma, parseTemplateParams } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { DATA_DIR } from '@/lib/paths'

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

// 剪映工程一键导入：媒体入库(幂等) + 建框架 + overlayTemplate 写 __defaultBgmId/__defaultAssetFolder。
// all-validate-before-any-write：先全量校验扩展名/字段,再落盘。
export const POST = handler(async (req) => {
  const s = await requireRole('operator')
  checkRate('jianying-import', s.userId, 10)
  const form = await req.formData()
  const name = String(form.get('name') ?? '').trim()
  if (!name) throw new HttpError(400, '框架名不能为空')
  const projectName = String(form.get('projectName') ?? '').trim()
  if (!projectName) throw new HttpError(400, '工程名不能为空')
  let templateParams: unknown
  try {
    templateParams = JSON.parse(String(form.get('templateParams') ?? ''))
  } catch {
    throw new HttpError(400, 'templateParams 不是合法 JSON')
  }
  let bgmMeta: { fileName: string; title: string }[] = []
  try {
    const parsed = JSON.parse(String(form.get('bgmMeta') ?? '[]'))
    if (Array.isArray(parsed)) {
      bgmMeta = parsed.filter(
        (x): x is { fileName: string; title: string } =>
          x && typeof x === 'object' && typeof x.fileName === 'string' && typeof x.title === 'string',
      )
    }
  } catch {
    throw new HttpError(400, 'bgmMeta 不是合法 JSON')
  }

  const watermark = String(form.get('watermark') ?? '').trim()
  const bodyCountRaw = Number(String(form.get('bodyCount') ?? ''))
  const bodyCount = Number.isInteger(bodyCountRaw) && bodyCountRaw > 0 ? bodyCountRaw : null

  const bgmFiles = form.getAll('bgmFiles').filter((f): f is File => f instanceof File)
  const imageFiles = form.getAll('imageFiles').filter((f): f is File => f instanceof File)

  // 全量校验
  for (const f of bgmFiles) {
    if (!AUDIO_EXT.has(path.extname(f.name).toLowerCase())) throw new HttpError(400, `不支持的音频文件：${f.name}`)
  }
  for (const f of imageFiles) {
    if (!IMAGE_EXT.has(path.extname(f.name).toLowerCase())) throw new HttpError(400, `不支持的图片文件：${f.name}`)
  }

  const skipped: string[] = []
  const bgmStat = { imported: 0, reused: 0 }
  const assetStat = { imported: 0, reused: 0 }

  // BGM 入库（幂等键：folder=工程名 + name=曲名）
  let defaultBgmId: string | null = null
  await fs.mkdir(path.join(DATA_DIR, 'bgm'), { recursive: true })
  for (const f of bgmFiles) {
    const title = bgmMeta.find((m) => m.fileName === f.name)?.title ?? path.basename(f.name, path.extname(f.name))
    const existing = await prisma.bgmLibrary.findFirst({ where: { folder: projectName, name: title } })
    if (existing) {
      bgmStat.reused++
      defaultBgmId = defaultBgmId ?? existing.id
      continue
    }
    const id = randomUUID()
    const rel = `bgm/${id}${path.extname(f.name).toLowerCase()}`
    await fs.writeFile(path.join(DATA_DIR, rel), Buffer.from(await f.arrayBuffer()))
    await prisma.bgmLibrary.create({
      data: { id, fileUrl: `/api/files/${rel}`, styleTag: null, durationMs: null, name: title, folder: projectName },
    })
    bgmStat.imported++
    defaultBgmId = defaultBgmId ?? id
  }

  // 图片素材入库（幂等键：folder=工程名 + name=去扩展名文件名）
  await fs.mkdir(path.join(DATA_DIR, 'assets'), { recursive: true })
  for (const f of imageFiles) {
    const assetName = path.basename(f.name, path.extname(f.name))
    const existing = await prisma.stockAsset.findFirst({ where: { folder: projectName, name: assetName } })
    if (existing) {
      assetStat.reused++
      continue
    }
    const id = randomUUID()
    const rel = `assets/${id}${path.extname(f.name).toLowerCase()}`
    await fs.writeFile(path.join(DATA_DIR, rel), Buffer.from(await f.arrayBuffer()))
    await prisma.stockAsset.create({ data: { id, kind: 'image', name: assetName, folder: projectName, fileUrl: `/api/files/${rel}` } })
    assetStat.imported++
  }

  // 建框架（口径同 jianying/save）+ 默认值
  const normalized = { ...parseTemplateParams(templateParams), mode: 'flash' as const }
  const overlayTemplate: Record<string, unknown> = { __templateParams: normalized }
  if (defaultBgmId) overlayTemplate.__defaultBgmId = defaultBgmId
  if (assetStat.imported + assetStat.reused > 0) overlayTemplate.__defaultAssetFolder = projectName
  if (watermark) overlayTemplate.watermark = watermark

  const fw = await prisma.copyFramework.create({
    data: {
      name,
      frameworkText: '（从剪映草稿导入的快闪模板，仅含画面/节奏参数，无文案框架，使用前请补充/编辑文案框架）',
      overlayTemplate: overlayTemplate as unknown as Prisma.InputJsonValue,
      createdBy: s.userId,
      ...(bodyCount ? { suggestedSegmentCount: bodyCount } : {}),
    },
  })
  return NextResponse.json({ id: fw.id, bgm: bgmStat, assets: assetStat, skipped })
})
