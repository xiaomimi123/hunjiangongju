import { promises as fs } from 'fs'
import path from 'path'
import { prisma, imageGenerate, setGenerationStatus, enqueueGen, withRetry } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { parseTemplateParams } from '../../templates/booklist/templateParams'
import { buildBookCoverPrompt } from '../../templates/booklist/bookCoverPrompt'
import { pickAssetsForSegments, readAssetSource } from './stockAssets'

// 取书单：overlayTemplate.books 优先，回退 variables.books；过滤无 title 的脏项。
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
  const fromOverlay = pick(overlayTemplate)
  return fromOverlay.length ? fromOverlay : pick(variables)
}

export async function generateImage(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({
    where: { id: genTaskId },
    include: { framework: true },
  })
  const stylePrompt = task.framework.imageStylePrompt ?? ''

  const segments = await prisma.generatedSegment.findMany({
    where: { generationTaskId: genTaskId },
    orderBy: { seqNo: 'asc' },
  })

  const dir = path.join(DATA_DIR, 'gen', genTaskId)
  await fs.mkdir(dir, { recursive: true })

  // 配图来源：素材库优先时，按分镜顺序分配素材库图片，够用的分镜跳过 AI 生图；不够的分镜（null）回退 AI。
  const { source: assetSource, folder: assetFolder } = readAssetSource(task.variables)
  const libraryAssets = assetSource === 'library'
    ? await prisma.stockAsset.findMany({
        where: { kind: 'image', ...(assetFolder ? { folder: assetFolder } : {}) },
        orderBy: { createdAt: 'asc' },
      })
    : []
  const assignedAssets = pickAssetsForSegments(libraryAssets, segments.length)

  for (const [i, seg] of segments.entries()) {
    const asset = assignedAssets[i]
    let imageUrl: string

    if (asset) {
      // 素材库命中：直接复用素材文件，不走 AI 生图。
      const ext = path.extname(asset.fileUrl) || '.jpg'
      const abs = path.join(dir, `${seg.seqNo}${ext}`)
      await fs.copyFile(urlToAbs(asset.fileUrl), abs)
      imageUrl = `/api/files/gen/${genTaskId}/${seg.seqNo}${ext}`
    } else {
      // 文案只作「画面意境」引导，绝不能把句子当文字画进图里（否则与字幕层叠字、乱码）。
      // 不提"书/书名/书页"等会诱导模型画出文字的词；只给情绪场景，配 negative_prompt 强力压制文字。
      const prompt = [stylePrompt, `一个能烘托这种情绪的安静场景：${seg.scriptText}`, '干净的纯画面场景，画面里不出现任何文字、书本上的字、招牌、字幕或水印']
        .filter(Boolean)
        .join('，')
      // 单张文生图偶发 504/超时是瞬时错误，逐图重试而非让整任务失败。
      const png = await withRetry(
        () =>
          imageGenerate({
            prompt,
            size: '720x960',
            negativePrompt: '人, 人物, 人脸, 人像, 手, person, people, human, face, portrait, man, woman, hands, 文字, 字, 汉字, 字母, 单词, 书法, 标题, 字幕, 水印, text, letters, words, caption, watermark, signature',
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
      imageUrl = `/api/files/gen/${genTaskId}/${seg.seqNo}.png`
    }

    await prisma.generatedSegment.update({
      where: { id: seg.id },
      data: { imageUrl },
    })
  }

  // flash 模式：为书单每本书补生一张「书封底图」(无字)，供快闪叠书名用。
  const params = parseTemplateParams((task.framework.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams)
  if (params.mode === 'flash') {
    const books = resolveBooks(task.framework.overlayTemplate, task.variables)
    const coversDir = path.join(dir, 'covers')
    await fs.mkdir(coversDir, { recursive: true })
    const styleHint = task.framework.imageStylePrompt ?? undefined
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
