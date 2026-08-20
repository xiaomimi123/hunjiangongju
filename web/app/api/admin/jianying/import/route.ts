import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import type { Prisma } from '@prisma/client'
import { prisma, parseTemplateParams, parseJianyingDraft, buildFidelityReport } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'
import { DATA_DIR } from '@/lib/paths'
import { makeThumb } from '@/lib/thumb'

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

  // 保真度报告：可选字段，收到的是原始草稿文件本体，能在服务端权威重算——比 save 路由
  // 收到的客户端回传报告更可信。缺失/不是合法 JSON 时报告直接置空，不影响导入本身
  // （报告纯信息性展示，沿用本路由"缺省字段一律不写、不因此拒绝导入"的既有口径）。
  let fidelityReport: ReturnType<typeof buildFidelityReport> | null = null
  let charBudget: { maxLines: number; maxTotalChars: number; hardCapChars: number } | null = null
  const draftJsonRaw = form.get('draftJson')
  if (typeof draftJsonRaw === 'string' && draftJsonRaw.trim()) {
    try {
      const draft = JSON.parse(draftJsonRaw)
      const { meta } = parseJianyingDraft(draft)
      fidelityReport = buildFidelityReport(meta.provenance, new Date().toISOString())
      charBudget = meta.charBudget ?? null
    } catch {
      fidelityReport = null
      charBudget = null
    }
  }

  const watermark = String(form.get('watermark') ?? '').trim()
  const bodyCountRaw = Number(String(form.get('bodyCount') ?? ''))
  const bodyCount = Number.isInteger(bodyCountRaw) && bodyCountRaw > 0 ? bodyCountRaw : null
  // 快闪书封位数：来自解析出的 structure.flashCount，供 resolveBookCount 优先读取，
  // 决定 AI 配齐书目的目标本数（§3.5）。同 bodyCount 一样是可选字段，缺省/非法一律不写。
  const flashCountRaw = Number(String(form.get('flashCount') ?? ''))
  const flashCount = Number.isInteger(flashCountRaw) && flashCountRaw > 0 ? flashCountRaw : null

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
    const abs = path.join(DATA_DIR, rel)
    await fs.writeFile(abs, Buffer.from(await f.arrayBuffer()))
    // 缩略图是锦上添花，绝不能因它失败拖垮批量导入：ffmpeg 缺失、损坏输入等一律吞掉只记 warning。
    try {
      await makeThumb(abs)
    } catch (err) {
      console.warn(`[jianying/import] makeThumb 异常(已忽略) ${abs}: ${(err as Error).message}`)
    }
    await prisma.stockAsset.create({ data: { id, kind: 'image', name: assetName, folder: projectName, fileUrl: `/api/files/${rel}` } })
    assetStat.imported++
  }

  // 建框架（口径同 jianying/save）+ 默认值
  const normalized = { ...parseTemplateParams(templateParams), mode: 'flash' as const }
  const overlayTemplate: Record<string, unknown> = { __templateParams: normalized }
  if (defaultBgmId) overlayTemplate.__defaultBgmId = defaultBgmId
  if (assetStat.imported + assetStat.reused > 0) overlayTemplate.__defaultAssetFolder = projectName
  if (watermark) overlayTemplate.watermark = watermark
  if (flashCount) overlayTemplate.__bookCount = flashCount
  // 图片槽位数 = 草稿正片段数。填了它，generate-script 会把文案规整成恰好这么多段，
  // 「第 N 张图」才有稳定含义，运营才能逐张配来源与提示词。slots 留空表示全部走默认行为。
  if (bodyCount) overlayTemplate.__imageSlots = { count: bodyCount, slots: [] }
  // 文案字数硬上限（30 秒成片反推）。软预算走 maxTotalChars 列，硬上限没有对应列，
  // 沿用 __bookCount 这套私有键约定放进 overlayTemplate，避免为一个数加迁移。
  if (charBudget) overlayTemplate.__charHardCap = charBudget.hardCapChars

  const fw = await prisma.copyFramework.create({
    data: {
      name,
      frameworkText: '（从剪映草稿导入的快闪模板，仅含画面/节奏参数，无文案框架，使用前请补充/编辑文案框架）',
      overlayTemplate: overlayTemplate as unknown as Prisma.InputJsonValue,
      createdBy: s.userId,
      ...(bodyCount ? { suggestedSegmentCount: bodyCount } : {}),
      // 文案字数预算：不写的话生成时走代码默认 220 字。客户样例正片仅 20.6 秒，
      // 220 字等于 10.7 字/秒，是原片实测语速的两倍多——AI 按预算写满，文案长得离谱，
      // 还被迫复述原著情节填字数。按草稿时长×实测语速推出的预算是 89 字。
      ...(charBudget ? { maxLines: charBudget.maxLines, maxTotalChars: charBudget.maxTotalChars } : {}),
      ...(fidelityReport ? { draftFidelityReport: fidelityReport as unknown as Prisma.InputJsonValue } : {}),
    },
  })
  return NextResponse.json({ id: fw.id, bgm: bgmStat, assets: assetStat, skipped })
})
