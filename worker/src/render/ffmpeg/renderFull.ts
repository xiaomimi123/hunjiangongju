// 混合方案的总装：开场碎片(HyperFrames 渲好的短片) + 快闪书封 + 正片，
// 拼成一条完整的**无声**视频，contract 与 HyperFrames 产出的 body.mp4 完全一致。
//
// 这样接入点极干净：render-visuals 换个实现产出同样的 body.mp4，
// 后面的 render-video（混音、BGM、音效、loudnorm）**一行都不用改**。
//
// ── 为什么「先拼接、再统一烧字幕」 ──
//
// 另一种做法是每段各烧各的字幕再拼。那样每段的 ASS 都要用段内本地时间，
// 拼接后一旦某段时长有一帧偏差，后面所有字幕就整体错位，且错位量随段数累积。
// 统一烧则字幕自始至终用**全片绝对时间**，与分段方式完全解耦——
// 分段怎么变，字幕位置都不动。
//
// ── 为什么只编码一次 ──
//
// 三段如果各自编码再 concat，中间那两次编码是白付的（而且 -c copy 拼接要求
// 三段编码参数完全一致，HyperFrames 那段不由我们控制，不能假设）。
// 全部走一张滤镜图、末尾只编一次，成本最低且没有拼接兼容性问题。

import { buildBodyGraph, type FfBodySegment } from './bodyGraph'
import { buildDecorChain, type DecorOpts } from './decor'
import { buildAss, subtitlesFilter, type AssStyleOpts, type AssFlashCue } from './ass'
import { bookTitleRuns, captionCues, type RenderBodySegment } from './renderBody'
import { rippleOverlayChain } from './ripple'

export interface FullFlashCard {
  coverAbs: string
  title: string
  author?: string
  startMs: number
  endMs: number
}

export interface RenderFullOpts {
  /** HyperFrames 渲好的开场碎片片段（无声）。缺省则整片从快闪开始 */
  openingClipAbs?: string
  flashCards: FullFlashCard[]
  bodySegments: RenderBodySegment[]
  width: number
  height: number
  fps: number
  keyframes?: { scaleFrom: number; scaleTo: number }[]
  bodyCycle?: { renderType: string; durationMs: number }[]
  flashBounceIn: boolean
  watermark?: string
  assStyle: AssStyleOpts
  decor: Omit<DecorOpts, 'width' | 'height'>
  /** 水波纹素材：PNG 序列的模式串 + 起点/时长（绝对时间）。缺省则不叠 */
  ripple?: { patternAbs: string; atMs: number; durationMs: number }
  assAbs: string
  outAbs: string
  fontsDir?: string
}

export interface RenderFullPlan {
  args: string[]
  assContent: string
  totalMs: number
}

export function buildRenderFullPlan(o: RenderFullOpts): RenderFullPlan {
  const inputArgs: string[] = []
  const chains: string[] = []
  const parts: string[] = []          // 参与 concat 的标签，按时间先后
  const norm = `format=yuv420p,fps=${o.fps},settb=AVTB,setsar=1`
  let idx = 0
  let totalMs = 0

  // ---- 开场碎片：HyperFrames 的产物，编码参数不由我们控制，必须先归一化 ----
  if (o.openingClipAbs) {
    inputArgs.push('-i', o.openingClipAbs)
    chains.push(`[${idx}:v]scale=${o.width}:${o.height},${norm},setpts=PTS-STARTPTS[op]`)
    parts.push('op')
    idx++
    // 开场时长以快闪首卡的起点为准——快闪紧接开场，不留缝
    totalMs = o.flashCards[0]?.startMs ?? 0
  }

  // ---- 快闪书封：全硬切 + 可选弹入 ----
  if (o.flashCards.length > 0) {
    const segs: FfBodySegment[] = o.flashCards.map((c, i) => ({
      imageAbs: c.coverAbs,
      durationMs: Math.max(1, c.endMs - c.startMs),
      ...(i > 0 ? { transitionIn: null as null } : {}),
      ...(o.flashBounceIn ? { motion: { scaleFrom: 1.12, scaleTo: 1 } } : {}),
    }))
    const g = buildBodyGraph({ segments: segs, width: o.width, height: o.height, fps: o.fps })
    // buildBodyGraph 用 [0:v] [1:v]… 的下标，这里整体偏移到当前输入位置
    chains.push(shiftInputIndices(g.filter, idx, 'fl'))
    inputArgs.push(...g.inputArgs)
    parts.push(`fl_${g.outLabel}`)
    idx += segs.length
    totalMs += g.totalMs
  }

  // ---- 正片 ----
  const cyc = o.bodyCycle ?? []
  const kfs = o.keyframes ?? []
  const bodySegs: FfBodySegment[] = o.bodySegments.map((s, i) => ({
    imageAbs: s.imageAbs,
    durationMs: Math.max(1, s.endMs - s.startMs),
    ...(kfs.length ? { motion: kfs[i % kfs.length] } : {}),
    ...(i > 0
      ? cyc.length === 0
        ? { transitionIn: null as null }
        : { transitionIn: 'crossfade' as const, transitionMs: cyc[(i - 1) % cyc.length].durationMs }
      : {}),
  }))
  const bg = buildBodyGraph({ segments: bodySegs, width: o.width, height: o.height, fps: o.fps })
  chains.push(shiftInputIndices(bg.filter, idx, 'bd'))
  inputArgs.push(...bg.inputArgs)
  parts.push(`bd_${bg.outLabel}`)
  idx += bodySegs.length
  totalMs += bg.totalMs

  // ---- 拼接 ----
  let cur: string
  if (parts.length === 1) {
    cur = parts[0]
  } else {
    cur = 'cat'
    chains.push(`${parts.map((p) => `[${p}]`).join('')}concat=n=${parts.length}:v=1:a=0,${norm}[cat]`)
  }

  // ---- 装饰层（压暗底/暗角/颗粒/调色）：与 HyperFrames 模板一致，作用于全片 ----
  const scrimIdx = idx
  const decor = buildDecorChain(cur, 'dec', { ...o.decor, width: o.width, height: o.height },
    o.decor.scrimHeightPx > 0 ? scrimIdx : undefined)
  inputArgs.push(...decor.inputArgs)
  if (decor.inputArgs.length) idx++
  chains.push(decor.chain)
  cur = 'dec'

  // ---- 水波纹：预渲染素材，叠在绝对时刻 ----
  if (o.ripple) {
    inputArgs.push('-framerate', String(o.fps), '-i', o.ripple.patternAbs)
    chains.push(rippleOverlayChain(cur, 'rip', idx, o.ripple.atMs, o.ripple.durationMs))
    cur = 'rip'
    idx++
  }

  // ---- 文字层：一次烧完，全部用全片绝对时间 ----
  const flashCues: AssFlashCue[] = o.flashCards.map((c) => ({
    title: c.title, ...(c.author ? { author: c.author } : {}), startMs: c.startMs, endMs: c.endMs,
  }))
  const assContent = buildAss({
    width: o.width, height: o.height, totalMs, style: o.assStyle,
    captions: captionCues(o.bodySegments),
    bookTitles: bookTitleRuns(o.bodySegments),
    flashCards: flashCues,
    ...(o.watermark ? { watermark: o.watermark } : {}),
  })
  chains.push(`[${cur}]${subtitlesFilter(o.assAbs, o.fontsDir)}[vout]`)

  const args = [
    '-y', ...inputArgs,
    '-filter_complex', chains.join(';'),
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
    '-an',                       // 无声：音频由 render-video 那步统一混
    o.outAbs,
  ]
  return { args, assContent, totalMs }
}

/**
 * 把 buildBodyGraph 产出的滤镜串整体搬到新的输入下标区间，并给内部标签加前缀。
 *
 * buildBodyGraph 假定自己的图片是 [0:v][1:v]…；总装时它前面还有别的输入，
 * 必须整体偏移。同时 v0/m1 这类内部标签在两段之间会重名，加前缀隔开。
 *
 * 只替换 `[N:v]` 形式的**输入引用**与 `v<N>`/`m<N>` 形式的**内部标签**，
 * 不碰滤镜参数里的数字（如 scale=1440:1920、duration=0.5）——
 * 用正则做整串替换很容易误伤，这里的模式刻意收得很窄。
 */
function shiftInputIndices(filter: string, offset: number, prefix: string): string {
  return filter
    .replace(/\[(\d+):v\]/g, (_m, n: string) => `[${Number(n) + offset}:v]`)
    .replace(/\[(v\d+|m\d+)\]/g, (_m, l: string) => `[${prefix}_${l}]`)
}
