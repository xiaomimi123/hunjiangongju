import { promises as fs } from 'fs'
import path from 'path'
import { prisma, imageGenerate, setGenerationStatus, enqueueGen, withRetry, readImageSlots, slotAt, readOpenImage } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { parseTemplateParams } from '../../templates/booklist/templateParams'
import { buildBookCoverPrompt } from '../../templates/booklist/bookCoverPrompt'
import { pickAssetsForSegments, readAssetSource, poolForFolder, resolveSlotFolders } from './stockAssets'
import { pickArtScenes, buildFreeArtPrompt, IMAGE_NEGATIVE_PROMPT } from './artScenes'
import { makeThumb } from '../thumb'

// 缩略图是锦上添花，绝不能因它失败拖垮生成/上传主流程：ffmpeg 缺失、损坏输入等一律吞掉只记 warning。
async function makeThumbSafely(abs: string): Promise<void> {
  try {
    await makeThumb(abs)
  } catch (err) {
    console.warn(`[gen] makeThumb 异常(已忽略) ${abs}: ${(err as Error).message}`)
  }
}

// 画风提示词留空时的默认兜底：厚涂油画质感，避免生成画面过于平淡。
export const DEFAULT_IMAGE_STYLE = '梵高后印象派风格,旋转笔触,厚重颜料肌理,鲜明蓝黄对比,星夜质感,无人物'

// 取书单：variables.books 优先，回退 overlayTemplate.books；过滤无 title 的脏项。
// 顺序在此**必须原样保留**——快闪书封按该顺序出卡，主题书排在末位即「最后一张定格」。
// 早前是框架书目优先，会让本次选出的书单（含主题书末位顺序）被整个绕开；框架自带书目
// 的定位是「原片信息，仅供参考」，不该压过 per-generation 的选择。
export function resolveBooks(overlayTemplate: unknown, variables: unknown): { title: string; author?: string }[] {
  const pick = (x: unknown): { title: string; author?: string }[] => {
    const arr = (x && typeof x === 'object' && Array.isArray((x as { books?: unknown }).books))
      ? ((x as { books: unknown[] }).books) : []
    return arr
      .filter((b) => b && typeof (b as { title?: unknown }).title === 'string' && (b as { title: string }).title.trim())
      .map((b) => {
        const o = b as { title: string; author?: unknown }
        return { title: o.title.trim(), ...(typeof o.author === 'string' && o.author.trim() ? { author: o.author.trim() } : {}) }
      })
  }
  const fromVars = pick(variables)
  return fromVars.length ? fromVars : pick(overlayTemplate)
}

export async function generateImage(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({
    where: { id: genTaskId },
    include: { framework: true },
  })
  const stylePrompt = (task.framework.imageStylePrompt ?? '').trim() || DEFAULT_IMAGE_STYLE

  const segments = await prisma.generatedSegment.findMany({
    where: { generationTaskId: genTaskId },
    orderBy: { seqNo: 'asc' },
  })

  const dir = path.join(DATA_DIR, 'gen', genTaskId)
  await fs.mkdir(dir, { recursive: true })

  // 逐槽位配置（框架配了 __imageSlots 时生效）：每个正片图片位单独指定来源与提示词。
  // 典型用法是「前几张 AI 精修、后面素材库随机」。未配置的槽位维持全局行为。
  const slotCfg = readImageSlots(task.framework.overlayTemplate)

  // 配图来源：素材库优先时，按分镜顺序分配素材库图片，够用的分镜跳过 AI 生图；不够的分镜（null）回退 AI。
  const { source: assetSource, folder: assetFolder } = readAssetSource(task.variables)
  // 逐槽位决定「这一张从哪个文件夹抽」：槽位自己的 folder 优先，其次是任务上的全局 folder。
  // 之前 slot.folder 只被解析、从未被使用 —— 后台能填、填了没用。
  const slotFolders = resolveSlotFolders(
    segments.length,
    (i) => slotAt(slotCfg, i)?.source,
    (i) => slotAt(slotCfg, i)?.folder,
    assetSource,
    assetFolder,
  )
  // 不按文件夹过滤地一次读全库，再在内存里分池：文件夹过滤有"留空=全库"这一档，
  // 用 SQL 表达会绕进 NULL 三值逻辑；素材库是每任务读一次的小表，放内存更清楚。
  const libraryAssets = slotFolders.some((f) => f !== null)
    ? await prisma.stockAsset.findMany({ where: { kind: 'image' }, orderBy: { createdAt: 'asc' } })
    : []
  // 按有效文件夹分组抽取：同组内不重复；不同组各抽各的池子。
  // 种子带上文件夹名，否则两个不同文件夹会抽到相同下标、看起来像"刻意配对"。
  const assignedAssets: (typeof libraryAssets[number] | null)[] = new Array(segments.length).fill(null)
  const byFolder = new Map<string, number[]>()
  slotFolders.forEach((f, i) => {
    if (f === null) return
    byFolder.set(f, [...(byFolder.get(f) ?? []), i])
  })
  for (const [folder, idxs] of byFolder) {
    const pool = poolForFolder(libraryAssets, folder || undefined)
    if (pool.length === 0) {
      console.warn(`[gen] generate-image ${genTaskId}: 素材文件夹「${folder || '(全库)'}」没有可用图片，这些槽位回退 AI 生图`)
    }
    // 传 genTaskId 作为随机种子：同任务可复现、不同任务不撞图。批量场景下这是必需的——
    // 不传的话每条片子都取素材库前几张，一天几千条全长一个样。
    const picked = pickAssetsForSegments(pool, idxs.length, `${genTaskId}:${folder}`)
    idxs.forEach((segIdx, k) => { assignedAssets[segIdx] = picked[k] })
  }

  // 配图与文案完全脱钩：主体只来自 genTaskId 派生的场景方向，不再由 LLM 从口播提炼画面
  // （那样必然逐句配插画：说碗画碗、说台阶画台阶）。同任务重跑一致，不同任务必然不同。
  const scenes = pickArtScenes(genTaskId, segments.length)

  for (const [i, seg] of segments.entries()) {
    const slot = slotAt(slotCfg, i)
    // 走不走素材库已经在 resolveSlotFolders 里定了（槽位显式来源优先于全局来源）；
    // 池子空时 assignedAssets[i] 为 null，该槽位自然回退 AI 生图。
    const asset = assignedAssets[i]
    let imageUrl: string

    if (asset) {
      // 素材库命中：直接复用素材文件，不走 AI 生图。
      const ext = path.extname(asset.fileUrl) || '.jpg'
      const abs = path.join(dir, `${seg.seqNo}${ext}`)
      await fs.copyFile(urlToAbs(asset.fileUrl), abs)
      await makeThumbSafely(abs)
      imageUrl = `/api/files/gen/${genTaskId}/${seg.seqNo}${ext}`
    } else {
      // 绝不能把文案当文字画进图里（否则与字幕层叠字、乱码）；禁文字约束在 buildFreeArtPrompt
      // 内保底，再配 negative_prompt 强力压制。人物不再被硬禁——由画风提示词决定。
      // 槽位配了 prompt 就用它当主体，否则回退场景池方向。
      // 画风优先用槽位自己的 style（支持「开场卡通头像、后面达芬奇」这种同片多画风），
      // 未配则沿用框架的 imageStylePrompt。
      const prompt = buildFreeArtPrompt(slot?.style ?? stylePrompt, slot?.prompt ?? scenes[i])
      // 单张文生图偶发 504/超时是瞬时错误，逐图重试而非让整任务失败。
      const png = await withRetry(
        () =>
          imageGenerate({
            prompt,
            size: '720x960',
            negativePrompt: IMAGE_NEGATIVE_PROMPT,
          }),
        {
          attempts: 3,
          delayMs: 3000,
          onRetry: (err, i) =>
            console.warn(`[gen] generate-image ${genTaskId} seg#${seg.seqNo} 第${i}次失败,重试: ${(err as Error).message?.slice(0, 100)}`),
        },
      )

      const abs = path.join(dir, `${seg.seqNo}.png`)
      await fs.writeFile(abs, png)
      await makeThumbSafely(abs)
      imageUrl = `/api/files/gen/${genTaskId}/${seg.seqNo}.png`
    }

    await prisma.generatedSegment.update({
      where: { id: seg.id },
      data: { imageUrl },
    })
  }

  const params = parseTemplateParams((task.framework.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams)

  // 开场碎裂那张图：**独立生成**，不占用正片第 1 张。
  // 没配就不生成，渲染层回退正片第 1 张（老框架零回归）。
  const openCfg = readOpenImage(task.framework.overlayTemplate)
  if (params.mode === 'flash' && openCfg) {
    // 主体缺省给「人物特写」：开场碎裂是整屏一张脸，给风景会碎得没有焦点。
    // 真正画成什么样由 style 决定（如「日系动漫男头像」）。
    const prompt = buildFreeArtPrompt(openCfg.style ?? stylePrompt, openCfg.prompt ?? '人物特写')
    const png = await withRetry(
      () => imageGenerate({ prompt, size: '720x960', negativePrompt: IMAGE_NEGATIVE_PROMPT }),
      {
        attempts: 3, delayMs: 3000,
        onRetry: (err, n) => console.warn(`[gen] open-image ${genTaskId} 第${n}次失败,重试: ${(err as Error).message?.slice(0, 90)}`),
      },
    )
    const abs = path.join(dir, 'open.png')
    await fs.writeFile(abs, png)
    await makeThumbSafely(abs)
    console.log(`[gen] generate-image ${genTaskId}: 开场图已生成 (${prompt.slice(0, 40)}…)`)
  }

  // flash 模式：为书单每本书补生一张「书封底图」(无字)，供快闪叠书名用。
  if (params.mode === 'flash') {
    const books = resolveBooks(task.framework.overlayTemplate, task.variables)
    const coversDir = path.join(dir, 'covers')
    await fs.mkdir(coversDir, { recursive: true })
    // || + trim:画风被清成空字符串时也回退 buildBookCoverPrompt 的默认(?? 只兜 null)
    const styleHint = (task.framework.imageStylePrompt || '').trim() || undefined
    for (const [i, book] of books.entries()) {
      const { prompt, negativePrompt } = buildBookCoverPrompt(book, styleHint)
      const png = await withRetry(() => imageGenerate({ prompt, size: '720x960', negativePrompt }), {
        attempts: 3, delayMs: 3000,
        onRetry: (err, n) => console.warn(`[gen] book-cover ${genTaskId} #${i} 第${n}次失败,重试: ${(err as Error).message?.slice(0, 90)}`),
      })
      await fs.writeFile(path.join(coversDir, `${String(i + 1).padStart(2, '0')}.png`), png)
    }
    console.log(`[gen] generate-image ${genTaskId}: flash 书封 ${books.length} 张`)
  }

  await setGenerationStatus(genTaskId, 'TTS_GENERATING')
  await enqueueGen('generate-tts', { genTaskId })
}
