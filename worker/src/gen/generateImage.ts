import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { prisma, imageGenerate, imageConcurrency, getCapabilityConfig, setGenerationStatus, enqueueGen, withRetry, readImageSlots, slotAt, readOpenImage, readCoverPrompt, publicAssetUrl, findCoversByTitles, setBookCover, normalizeTitle, buildBookCoverPrompt } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { parseTemplateParams } from '../../templates/booklist/templateParams'
import { pickAssetsForSegments, readAssetSource, poolForFolder, resolveSlotFolders } from './stockAssets'
import { mapLimited } from './mapLimited'
import { pickArtScenes, composeArtPrompt, IMAGE_NEGATIVE_PROMPT } from './artScenes'
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

/**
 * 框架没填画风时用的兜底。
 *
 * ★ 这里**不能**放带流派签名的画风。原值是「梵高后印象派风格,旋转笔触,厚重颜料肌理,…」，
 * 而后台那个输入框连 placeholder 都没有——运营看到的是空白框，出来的图却全是梵高，
 * 从界面上完全看不出这个默认值的存在（线上实测反馈：「我什么都没填，为什么都是梵高」）。
 *
 * 也不能干脆留空：一条片子四张图各自发一次生图请求，没有统一画风约束时，
 * 模型可能给出照片/插画/3D 混搭的四张，成片观感是坏的。
 * 所以兜底取**中性但一致**的方向——只约束质感与光线，不指定任何画派。
 * 同一份文案要什么画派，由运营在框架里显式填，或用「参考图反推」。
 */
export const DEFAULT_IMAGE_STYLE = '写实摄影质感,柔和自然光,低饱和统一色调,浅景深,电影感构图'

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
  const framed = (task.framework.imageStylePrompt ?? '').trim()
  const stylePrompt = framed || DEFAULT_IMAGE_STYLE
  // 画风是成片观感的头号变量，务必让日志能回答「这条片子到底用了哪个画风、是谁给的」
  console.log(`[gen] generate-image ${genTaskId}: 画风=${framed ? '框架指定' : '默认兜底'} 「${stylePrompt}」`)

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

  // 并发数从 image 能力的 extra.concurrency 读（模型配置页可调，不用重新部署）。
  // 单 Key 账号的经验值是 4；配了多 Key（extra.apiKeys 轮询）后按 4×Key 数调升。
  const conc = imageConcurrency((await getCapabilityConfig('image')).extra)
  console.log(`[gen] generate-image ${genTaskId}: 生图并发 ${conc}`)

  // ★ 正片配图并行化。此前是纯串行——书封那边早就并行了（占全片 71% 的教训），
  // 正片 4~8 张一直串行跑，同样是纯网络等待，一张 50 秒就是 200~400 秒白排队。
  await mapLimited(segments, conc, async (seg, i) => {
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
      // 绝不能把文案当文字画进图里（否则与字幕层叠字、乱码）；禁文字约束在尾巴
      // 内保底，再配 negative_prompt 强力压制。人物不再被硬禁——由提示词决定。
      // 拼接规则见 composeArtPrompt：槽位提示词**原样直发**，全局画风只对没填
      // 提示词的槽位兜底（老注释说"画风未配则沿用框架的"——那正是被修掉的污染）。
      const prompt = composeArtPrompt({ slotPrompt: slot?.prompt, slotStyle: slot?.style, globalStyle: stylePrompt, scene: scenes[i] })
      // 打印**最终**提示词：运营在控制台直接测的是裸提示词，走流水线会经过
      // 「画风 + 画什么 + 竖屏尾巴」的拼接——效果对不上时先看这行，别猜。
      console.log(`[gen] generate-image ${genTaskId}: 正片#${i + 1} 提示词「${prompt}」`)
      // 参考图：配了就让它参与生成（模型直接沿用其笔触与配色，比文字描述准）。
      // 签名是短时效的，每张图各签一次，不要提到循环外复用。
      const refUrl = slot?.refImage ? publicAssetUrl(slot.refImage) : undefined
      // 单张文生图偶发 504/超时是瞬时错误，逐图重试而非让整任务失败。
      const png = await withRetry(
        () =>
          imageGenerate({
            prompt,
            size: '720x960',
            negativePrompt: IMAGE_NEGATIVE_PROMPT,
            ...(refUrl ? { refImageUrl: refUrl } : {}),
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
  })

  const params = parseTemplateParams((task.framework.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams)

  // 开场碎裂那张图：**独立生成**，不占用正片第 1 张。
  // 没配就不生成，渲染层回退正片第 1 张（老框架零回归）。
  const openCfg = readOpenImage(task.framework.overlayTemplate)
  if (params.mode === 'flash' && openCfg) {
    // 主体缺省给「人物特写」：开场碎裂是整屏一张脸，给风景会碎得没有焦点。
    // 真正画成什么样由 style 决定（如「日系动漫男头像」）。
    const prompt = composeArtPrompt({ slotPrompt: openCfg.prompt, slotStyle: openCfg.style, globalStyle: stylePrompt, scene: '人物特写' })
    const openRef = openCfg.refImage ? publicAssetUrl(openCfg.refImage) : undefined
    const png = await withRetry(
      () => imageGenerate({
        prompt, size: '720x960', negativePrompt: IMAGE_NEGATIVE_PROMPT,
        ...(openRef ? { refImageUrl: openRef } : {}),
      }),
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
    // 框架专属的书封提示词。配了它就**完全不走缓存**（用户拍板）：
    // - 不吃公共书库的封面缓存——那些按默认外壳生成，风格对不上；
    // - 不写回公共书库——会污染其它框架复用的封面；
    // - 也不做专属缓存——每条任务每本书都全新生成一次。运营的提示词是
    //   开放式的（「某一本著名文学名著的封面」），缓存会把第一次的随机结果
    //   永久钉死，此后条条片子长一样，与提示词的意图相反。
    // 代价明说：每条任务 N 本书 N 次生图调用（约 50s/张、并发 4）。
    const coverPrompt = readCoverPrompt(task.framework.overlayTemplate)
    if (coverPrompt) console.log(`[gen] generate-image ${genTaskId}: 书封用框架专属提示词，全新生成不走缓存「${coverPrompt.slice(0, 40)}…」`)
    // ★ 书封只跟「这本书」有关，跟这条片子的文案毫无关系——所以做一次就够了。
    // 原先每条片子都为每本书重生成一张，9 本书就是 9 次生图调用；
    // 一天几千条时这是成本大头，而其中绝大多数是同样那几本常见书。
    const cached = await findCoversByTitles(books)
    let reused = 0
    // ★ 并行生成。线上实测串行跑 8 张书封用了 422 秒（52.8s/张），占全片 71% ——
    // 而这些调用之间毫无依赖、纯粹在等网络。
    // 并发取 4 而不是全量：百炼有 QPS 限制，一次打太多会 429，重试反而更慢。
    // 4 已经把 422 秒压到约 106 秒，再往上边际收益递减、被限流的风险上升。
    await mapLimited(books, conc, async (book, i) => {
      const dst = path.join(coversDir, `${String(i + 1).padStart(2, '0')}.png`)
      if (coverPrompt) {
        // 全新生成，不读不写任何缓存（理由见上）
        const { prompt, negativePrompt } = buildBookCoverPrompt(book, styleHint, coverPrompt)
        if (i === 0) console.log(`[gen] book-cover ${genTaskId}: 最终提示词「${prompt}」 负向「${negativePrompt.slice(0, 40)}…」`)
        const png = await withRetry(() => imageGenerate({ prompt, size: '720x960', negativePrompt }), {
          attempts: 3, delayMs: 3000,
          onRetry: (err, n) => console.warn(`[gen] book-cover ${genTaskId} #${i} 第${n}次失败,重试: ${(err as Error).message?.slice(0, 90)}`),
        })
        await fs.writeFile(dst, png)
        return
      }
      const hit = cached.get(normalizeTitle(book.title))
      if (hit) {
        try {
          await fs.copyFile(urlToAbs(hit.url), dst)
          reused++
          return
        } catch (err) {
          // 库里登记了封面但文件没了（手工删过 data/、或换过机器）：
          // 不能让整批出片失败，退回现做一张
          console.warn(`[gen] book-cover ${genTaskId} #${i} 复用失败(${hit.url})，改为现做: ${(err as Error).message?.slice(0, 80)}`)
        }
      }
      const { prompt, negativePrompt } = buildBookCoverPrompt(book, styleHint)
      const png = await withRetry(() => imageGenerate({ prompt, size: '720x960', negativePrompt }), {
        attempts: 3, delayMs: 3000,
        onRetry: (err, n) => console.warn(`[gen] book-cover ${genTaskId} #${i} 第${n}次失败,重试: ${(err as Error).message?.slice(0, 90)}`),
      })
      await fs.writeFile(dst, png)
      // 回写书库：存到公共目录而不是任务目录——任务目录会被清理，
      // 而书封要长期复用。回写失败只记 warning，不影响本条出片。
      try {
        const rel = `covers/${randomUUID()}.png`
        const abs = path.join(DATA_DIR, rel)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, png)
        await makeThumbSafely(abs)
        await setBookCover(book.title, book.author, `/api/files/${rel}`, 'ai')
      } catch (err) {
        console.warn(`[gen] book-cover ${genTaskId} #${i} 回写书库失败(不影响出片): ${(err as Error).message?.slice(0, 80)}`)
      }
    })
    console.log(`[gen] generate-image ${genTaskId}: flash 书封 ${books.length} 张（复用 ${reused}，新生成 ${books.length - reused}）`)
  }

  await setGenerationStatus(genTaskId, 'TTS_GENERATING')
  await enqueueGen('generate-tts', { genTaskId })
}
