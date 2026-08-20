// 正片渲染管线：把 BodyData + TemplateParams 映射成一条完整的 ffmpeg 命令。
//
// 混合方案下这里只负责**正片段**（快闪结束之后那一段，约占片长 80%）；
// 开场碎片仍由 HyperFrames 渲，最后两段拼起来。
//
// 关键约束：与 HyperFrames 渲染器**消费同一份 BodyData**。灰度切换的前提是
// 两条路径吃一样的输入——否则「切回去」只是理论上的退路，实际根本切不动。

import { buildBodyGraph, type FfBodySegment } from './bodyGraph'
import { buildDecorChain, type DecorOpts } from './decor'
import { buildAss, subtitlesFilter, type AssCue, type AssStyleOpts } from './ass'

export interface RenderBodySegment {
  imageAbs: string
  startMs: number
  endMs: number
  bookTitle?: string
  bookAuthor?: string
  captionBeats?: { zh: string; startMs: number; endMs: number }[]
  subtitle?: string
}

export interface RenderBodyOpts {
  segments: RenderBodySegment[]
  width: number
  height: number
  fps: number
  /** 正片在整片中的起点。字幕时间是全片绝对值，渲染单独的正片片段时要减掉它 */
  timeOffsetMs: number
  /** 实测运镜序列，按顺序循环套用；空则各段静止 */
  keyframes?: { scaleFrom: number; scaleTo: number }[]
  /** 进正片那一刀是否硬切（本模块只渲正片，故它只影响首段是否需要淡入） */
  enterBodyHardCut?: boolean
  /** 正片内部边界的实测转场，按序循环 */
  bodyCycle?: { renderType: string; durationMs: number }[]
  watermark?: string
  assStyle: AssStyleOpts
  decor: Omit<DecorOpts, 'width' | 'height'>
  /** ASS 文件的绝对路径（调用方负责把 assContent 写到这里） */
  assAbs: string
  outAbs: string
  fontsDir?: string
}

export interface RenderBodyPlan {
  args: string[]
  assContent: string
  totalMs: number
}

/**
 * 连续同书名合并成一个运行段。
 *
 * 与 indexHtml.ts 的 bookRuns 是同一套语义，**必须保持一致**——两个渲染器
 * 对「书名什么时候换」的理解不同，会让灰度切换时画面出现看不出原因的差异。
 */
export function bookTitleRuns(segs: RenderBodySegment[]): AssCue[] {
  const runs: AssCue[] = []
  for (const s of segs) {
    const title = (s.bookTitle ?? '').trim()
    if (!title) continue
    // 用真换行符,**不要**在这里写 ASS 的 \N —— escapeAssText 会把反斜杠再转义一次,
    // 成片上会多出一个可见的反斜杠(《简爱》\ 换行 作者)。换行统一由 escapeAssText 负责。
    const text = s.bookAuthor?.trim() ? `《${title}》\n${s.bookAuthor.trim()}` : `《${title}》`
    const prev = runs[runs.length - 1]
    if (prev && prev.text === text) prev.endMs = s.endMs
    else runs.push({ text, startMs: s.startMs, endMs: s.endMs })
  }
  return runs
}

/** 字幕拍点。段没有 captionBeats 时退化成「整段一条字幕」，与 HyperFrames 分支一致。 */
export function captionCues(segs: RenderBodySegment[]): AssCue[] {
  const out: AssCue[] = []
  for (const s of segs) {
    const beats = s.captionBeats?.length
      ? s.captionBeats
      : [{ zh: s.subtitle ?? '', startMs: s.startMs, endMs: s.endMs }]
    for (const b of beats) {
      if (!b.zh?.trim()) continue
      out.push({ text: b.zh, startMs: b.startMs, endMs: b.endMs })
    }
  }
  return out
}

export function buildRenderBodyPlan(o: RenderBodyOpts): RenderBodyPlan {
  const cyc = o.bodyCycle ?? []
  const kfs = o.keyframes ?? []

  const segs: FfBodySegment[] = o.segments.map((s, i) => {
    // 运镜按序循环套用：分镜数与原工程不一定一致，循环保留原片的节奏感
    const kf = kfs.length ? kfs[i % kfs.length] : undefined
    // 第 0 段是「进正片那一刀」，其转场由上一层（与开场段拼接时）负责，这里不画
    let transitionIn: 'crossfade' | null | undefined
    let transitionMs: number | undefined
    if (i > 0) {
      if (cyc.length === 0) {
        transitionIn = null // 没有实测序列时一律硬切，不凭空造叠化
      } else {
        const b = cyc[(i - 1) % cyc.length]
        // 渲染层目前只实现了叠化。其余类型一律退化为叠化——与解析器
        // JIANYING_TRANSITION_MAP 未命中时的处理一致，保真度报告会如实标出。
        transitionIn = 'crossfade'
        transitionMs = b.durationMs
      }
    }
    return {
      imageAbs: s.imageAbs,
      durationMs: Math.max(1, s.endMs - s.startMs),
      ...(kf ? { motion: kf } : {}),
      ...(i > 0 ? { transitionIn: transitionIn ?? null, transitionMs } : {}),
    }
  })

  const graph = buildBodyGraph({ segments: segs, width: o.width, height: o.height, fps: o.fps })

  // 装饰层的 lavfi 输入排在所有图片输入之后
  const scrimIndex = o.segments.length
  const decor = buildDecorChain(graph.outLabel, 'dec', { ...o.decor, width: o.width, height: o.height }, o.decor.scrimHeightPx > 0 ? scrimIndex : undefined)

  // 字幕时间是全片绝对值；单独渲正片片段时整体左移
  const shift = (c: AssCue): AssCue => ({ ...c, startMs: c.startMs - o.timeOffsetMs, endMs: c.endMs - o.timeOffsetMs })
  const assContent = buildAss({
    width: o.width,
    height: o.height,
    totalMs: graph.totalMs,
    style: o.assStyle,
    captions: captionCues(o.segments).map(shift),
    bookTitles: bookTitleRuns(o.segments).map(shift),
    ...(o.watermark ? { watermark: o.watermark } : {}),
  })

  // 字幕最后烧：压暗底压在字幕下面、暗角不压字幕
  const filter = `${graph.filter};${decor.chain};[dec]${subtitlesFilter(o.assAbs, o.fontsDir)}[vout]`

  const args = [
    '-y',
    ...graph.inputArgs,
    ...decor.inputArgs,
    '-filter_complex', filter,
    '-map', '[vout]',
    // 中间产物用高质量(crf 18)而不是成片的 28。两个理由:
    //
    // 1. **它还要被重编一次**。body.mp4 交给 render-video 混音时会再编码一遍,
    //    中间产物压得狠等于把损失叠加两次。中间产物近无损是通行做法。
    // 2. **低码率会把慢速运镜量化掉**。预放大 8 倍后每帧位移约 0.5 像素,
    //    x264 在 crf 28 下把这点残差直接编成 skip 块 —— 实测连续两帧完全不动、
    //    再靠一次刷新补回来,肉眼就是卡顿。实测逐帧变化:
    //      crf 28: 2 2 2 … 0 0 42   (两帧卡住)
    //      crf 18: 6 4 5 4 4 4 4 …  (0 帧卡住)
    //    文件大到 10MB/23秒,但它是临时文件,混完就删。
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    // 正片段不含音频：音频在最后一步与开场段一起混（见 renderVideo.ts）
    '-an',
    o.outAbs,
  ]

  return { args, assContent, totalMs: graph.totalMs }
}
