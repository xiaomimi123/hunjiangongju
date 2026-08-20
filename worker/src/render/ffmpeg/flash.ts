// 快闪书封段：N 张书封逐张硬切闪过，每张压书名 + 作者。
//
// 结构上与正片是同一回事（静图 + 逐卡时长 + 硬切），所以视觉部分直接复用 buildBodyGraph，
// 这里只负责「逐卡时长怎么来」和「文字怎么排」。
//
// 实测客户样例：开场结束 2.159s → 快闪结束 3.984s，共 1.825s 排 9 张卡，
// 每张 150~251ms 长短相间——**不是等分**。等分会把原片的律动抹平，
// 实测切点偏差最大 58.7ms（近两帧）。

import { buildBodyGraph, type FfBodySegment } from './bodyGraph'
import { toAssColor, toAssTime, escapeAssText, subtitlesFilter } from './ass'

export interface FlashCard {
  coverAbs: string
  title: string
  author?: string
  /** 绝对时间（全片坐标） */
  startMs: number
  endMs: number
}

export interface FlashStyleOpts {
  fontName: string
  titleSizePx: number
  titleColor: string
  authorSizePx: number
  authorColor: string
}

export interface FlashOpts {
  cards: FlashCard[]
  width: number
  height: number
  fps: number
  /** 快闪段在整片中的起点；单独渲片段时字幕时间要减掉它 */
  timeOffsetMs: number
  /**
   * 弹入。**是近似**：原模板是「从 0.86 倍弹到 1 倍」（由小变大），
   * 而 ffmpeg 的 zoompan 缩放下界是 1、做不到小于画布的尺寸。
   * 这里退化成「从 1.12 倍收到 1 倍」（由大收小），力度相近、方向相反。
   * 每张卡只有 150~250ms，这个差异在实际观感里几乎不可辨，但不要当成等价复刻。
   */
  bounceIn: boolean
  assStyle: FlashStyleOpts
  assAbs: string
  outAbs: string
  fontsDir?: string
}

/**
 * 按草稿的逐卡时长比例，把 N 张卡排进实际窗口。
 *
 * 为什么不等分：原工程各卡长短不一（150/251/195/191/204/197/189/222/221ms），
 * 那种长短相间的律动就是「卡点」的本质。等分排布实测切点偏差最大 58.7ms。
 * 卡数多于草稿条目时循环复用比例。
 *
 * @param weights 草稿实测的逐卡时长；空则等分
 */
export function distributeCards(count: number, windowMs: number, weights?: number[]): { startMs: number; endMs: number }[] {
  if (count <= 0 || windowMs <= 0) return []
  const w = (weights ?? []).filter((x) => Number.isFinite(x) && x > 0)
  const use = w.length > 0
    ? Array.from({ length: count }, (_, i) => w[i % w.length])
    : Array.from({ length: count }, () => 1)
  const total = use.reduce((a, b) => a + b, 0)
  const out: { startMs: number; endMs: number }[] = []
  let acc = 0
  for (const x of use) {
    const start = Math.round(acc)
    acc += (x / total) * windowMs
    out.push({ startMs: start, endMs: Math.round(acc) })
  }
  // 最后一张对齐到窗口右端，避免累计取整误差留下 1~2ms 的缝
  if (out.length) out[out.length - 1].endMs = Math.round(windowMs)
  return out
}

/**
 * 快闪段的 ASS。样式与正片不同：书名居中大字、作者在其下方，都不带压暗底。
 * 复用 ass.ts 的转换原语，颜色/时间码/转义的那三个坑不重复踩。
 */
export function buildFlashAss(o: FlashOpts, totalMs: number): string {
  const st = o.assStyle
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes',
    `PlayResX: ${o.width}`, `PlayResY: ${o.height}`, '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // an5 = 正中；MarginV 对 an5 无效，位置靠 \pos 精确给
    `Style: ft,${st.fontName},${st.titleSizePx},${toAssColor(st.titleColor)},${toAssColor('#ffffff')},${toAssColor('#000000')},${toAssColor('#000000', 180)},1,0,0,0,100,100,0,0,1,3,3,5,40,40,0,1`,
    `Style: fa,${st.fontName},${st.authorSizePx},${toAssColor(st.authorColor)},${toAssColor('#ffffff')},${toAssColor('#000000')},${toAssColor('#000000', 180)},1,0,0,0,100,100,0,0,1,2,2,5,40,40,0,1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  // 与 HyperFrames 模板一致：书名在 50% 高度、作者在 62%
  const titleY = Math.round(o.height * 0.5)
  const authorY = Math.round(o.height * 0.62)
  const cx = Math.round(o.width / 2)

  const ev: string[] = []
  for (const c of o.cards) {
    const s = c.startMs - o.timeOffsetMs
    const e = Math.min(c.endMs - o.timeOffsetMs, totalMs)
    if (!(e > s)) continue
    const title = escapeAssText(`《${c.title}》`)
    if (title) ev.push(`Dialogue: 0,${toAssTime(s)},${toAssTime(e)},ft,,0,0,0,,{\\pos(${cx},${titleY})}${title}`)
    const author = escapeAssText(c.author ?? '')
    if (author) ev.push(`Dialogue: 0,${toAssTime(s)},${toAssTime(e)},fa,,0,0,0,,{\\pos(${cx},${authorY})}${author}`)
  }
  return `${header.join('\n')}\n${ev.join('\n')}\n`
}

export interface FlashPlan {
  args: string[]
  assContent: string
  totalMs: number
}

export function buildFlashPlan(o: FlashOpts): FlashPlan {
  const segs: FfBodySegment[] = o.cards.map((c, i) => ({
    imageAbs: c.coverAbs,
    durationMs: Math.max(1, c.endMs - c.startMs),
    // 快闪段全是硬切——草稿里这一段的边界没有挂任何转场素材
    ...(i > 0 ? { transitionIn: null as null } : {}),
    ...(o.bounceIn ? { motion: { scaleFrom: 1.12, scaleTo: 1 } } : {}),
  }))

  const graph = buildBodyGraph({ segments: segs, width: o.width, height: o.height, fps: o.fps })
  const assContent = buildFlashAss(o, graph.totalMs)
  const filter = `${graph.filter};[${graph.outLabel}]${subtitlesFilter(o.assAbs, o.fontsDir)}[vout]`

  const args = [
    '-y',
    ...graph.inputArgs,
    '-filter_complex', filter,
    '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-an',
    o.outAbs,
  ]
  return { args, assContent, totalMs: graph.totalMs }
}
