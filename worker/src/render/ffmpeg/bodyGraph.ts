// 正片视觉的 ffmpeg 滤镜图：静图 → 运镜 → 逐边界转场 → 一条连续视频流。
//
// 这是 FFmpeg 渲染迁移的核心。它替代 HyperFrames 承担片长约 80% 的那一段
// （开场碎片仍由 HyperFrames 渲，见 docs/superpowers/specs/2026-08-20-ffmpeg-render-migration-design.md）。
//
// 纯函数：只拼字符串，不碰文件系统、不跑进程。这样单测能覆盖所有分支，
// 真渲验收只需再跑一遍产出的命令即可。

/** 渲染器支持的转场类型。null 表示硬切（草稿里没挂转场素材的边界）。 */
export type FfTransition = 'crossfade' | null

export interface FfBodySegment {
  /** 图片绝对路径 */
  imageAbs: string
  durationMs: number
  /** 运镜：段内从 scaleFrom 线性缩放到 scaleTo。缺省或两者相等 = 静止。 */
  motion?: { scaleFrom: number; scaleTo: number }
  /** 进入本段的转场；第 0 段忽略。null = 硬切 */
  transitionIn?: FfTransition
  /** 转场时长(ms)，仅 transitionIn 非 null 时有意义 */
  transitionMs?: number
}

export interface BodyGraphOpts {
  segments: FfBodySegment[]
  width: number
  height: number
  fps: number
}

export interface BodyGraph {
  /** 拼在 ffmpeg 命令里的输入参数（每段一张静图，按 segments 顺序） */
  inputArgs: string[]
  /** filter_complex 的内容 */
  filter: string
  /** 最终视频流标签 */
  outLabel: string
  /** 全片总时长(ms)。叠化会吃掉时长，这里已经扣过 */
  totalMs: number
}

/**
 * 运镜的预放大倍数。
 *
 * zoompan 是**在输入分辨率上按整数像素裁剪**的，直接对 720×960 的图做 1.0→1.1 缩放，
 * 每帧裁剪窗口的取整误差会表现成肉眼可见的抖动（画面一顿一顿地跳）。
 * 先把图放大到 PRESCALE 倍再 zoompan，同样的取整误差落在更细的网格上，抖动不可见。
 * 这是 zoompan 众所周知的坑，不是可选优化。
 *
 * 取 2 是成本与效果的折中：再高只增加内存与带宽，抖动已经看不出来。
 */
const PRESCALE = 2

/**
 * 每一路视频流的归一化后缀。
 *
 * **不能省。** xfade 要求两路输入的像素格式、帧率、时基完全一致，否则直接报
 * `Failed to configure output pad`。实测触发点：前一路是 concat 的输出时——
 * concat 产出的时基与单段链不同，紧跟一个叠化边界就会炸。
 * 单段直接接 xfade 反而不会炸，所以这个坑只在「硬切后面跟叠化」的混排里出现，
 * 而客户样例恰恰就是这种形态（前 10 个边界硬切、后 3 个叠化）。
 */
const norm = (fps: number) => `format=yuv420p,fps=${fps},settb=AVTB`

function r3(x: number): number {
  return Math.round(x * 1000) / 1000
}

/** 单段：静图 → 预放大 → 运镜 → 定时长。产出标签 [vN] */
function segmentChain(s: FfBodySegment, i: number, o: BodyGraphOpts): string {
  const frames = Math.max(1, Math.round((s.durationMs / 1000) * o.fps))
  const from = s.motion?.scaleFrom ?? 1
  const to = s.motion?.scaleTo ?? 1
  const pre = `[${i}:v]scale=${o.width * PRESCALE}:${o.height * PRESCALE}:force_original_aspect_ratio=increase,` +
    `crop=${o.width * PRESCALE}:${o.height * PRESCALE}`

  // 静止段不走 zoompan：省一次重采样，也避免 zoompan 在 z 恒定时的行为差异。
  // （线上出过一次 zoompan 把画面冻住的事故，能不用就不用。）
  if (r3(from) === r3(to)) {
    const z = r3(from)
    const still = z === 1
      ? `scale=${o.width}:${o.height}`
      // 静态缩放：直接按倍数裁一块再缩回画布，等价于「定格在该缩放量上」
      : `crop=${Math.round((o.width * PRESCALE) / z)}:${Math.round((o.height * PRESCALE) / z)},scale=${o.width}:${o.height}`
    return `${pre},${still},fps=${o.fps},trim=duration=${r3(s.durationMs / 1000)},setpts=PTS-STARTPTS,${norm(o.fps)}[v${i}]`
  }

  // 逐帧线性插值，与剪映关键帧的语义一致（实测其控制点均为 (0,0) 即线性）。
  // on 是**输出帧序号**；除以 frames-1 让末帧恰好落在 to 上，不过冲。
  const denom = Math.max(1, frames - 1)
  const z = `'${r3(from)}+(${r3(to - from)})*on/${denom}'`
  return `${pre},zoompan=z=${z}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${o.width}x${o.height}:fps=${o.fps},` +
    `trim=duration=${r3(s.durationMs / 1000)},setpts=PTS-STARTPTS,${norm(o.fps)}[v${i}]`
}

/**
 * 把 N 段折叠成一条流。
 *
 * 为什么逐对折叠而不是一次 concat：本片的边界是**混排**的——客户样例 13 个边界里
 * 10 个硬切、3 个叠化。concat 只能处理硬切，xfade 只吃两路输入，两者没法在一个
 * 滤镜里混用。逐对折叠让每个边界各自选 concat 还是 xfade，代码也只有一条路径。
 *
 * 关键陷阱：**xfade 会把总时长缩短一个转场时长**（两段重叠播放）。所以 offset
 * 必须用「已折叠部分的当前时长减去本次转场时长」，且累计时长要相应扣减——
 * 算错的话后面每个边界的时间点都会漂移，且越往后越离谱。
 */
export function buildBodyGraph(o: BodyGraphOpts): BodyGraph {
  const segs = o.segments
  if (segs.length === 0) return { inputArgs: [], filter: '', outLabel: '', totalMs: 0 }

  const inputArgs: string[] = []
  const chains: string[] = []
  for (const [i, s] of segs.entries()) {
    // -loop 1 把静图变成无限帧流，-t 限定时长；framerate 与输出一致，避免后续重采样
    inputArgs.push('-loop', '1', '-framerate', String(o.fps), '-t', r3(s.durationMs / 1000).toString(), '-i', s.imageAbs)
    chains.push(segmentChain(s, i, o))
  }

  let acc = 'v0'
  let accMs = segs[0].durationMs
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i]
    const next = `m${i}`
    const hard = s.transitionIn == null
    if (hard) {
      chains.push(`[${acc}][v${i}]concat=n=2:v=1:a=0,${norm(o.fps)}[${next}]`)
      accMs += s.durationMs
    } else {
      // 转场窗口不得超过相邻两段中较短者，否则 xfade 会吃掉整段甚至报错
      const maxMs = Math.min(accMs, s.durationMs)
      const dMs = Math.max(1, Math.min(s.transitionMs ?? 400, maxMs))
      const offset = r3((accMs - dMs) / 1000)
      chains.push(`[${acc}][v${i}]xfade=transition=fade:duration=${r3(dMs / 1000)}:offset=${offset}[${next}]`)
      accMs += s.durationMs - dMs
    }
    acc = next
  }

  return { inputArgs, filter: chains.join(';'), outLabel: acc, totalMs: Math.round(accMs) }
}
