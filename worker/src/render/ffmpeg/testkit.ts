// 真渲验收专用的测量工具。**只被 *.e2e.test.ts 使用**，不参与生产代码路径。
//
// ── 为什么不能再用「帧 md5 是否相同」判断画面动没动 ──
//
// 最初的做法是取两帧算 md5，相同即判定定格。它在**纯色**画面上成立，
// 但在**有纹理**的画面上是假绿：x264 在 crf 28 下会逐帧调整量化参数，
// 解码出来的像素有微小差异，于是「定格的纹理画面」也会给出两个不同的 md5。
//
// 实测：一张 testsrc 花纹静图、关掉运镜渲成 mp4，卡内 6 个时刻取到 5 个不同的 md5。
// 换句话说，「帧指纹互不相同 ⇒ 画面在动」这个推断是错的，
// 所有基于它的「运镜生效」断言都可能在运镜坏掉时照样通过。
//
// ── 第二次修正：平均绝对差也不够 ──
//
// 平均绝对差对「缓慢推近」不敏感。实测：1.0→1.108 的推近，相隔 1.5 秒两帧的
// 平均绝对差只有 3.4，而静止画面的编码噪声是 3 —— 两者几乎贴在一起，没有判别力。
//
// 原因是两种变化的**分布**完全不同：编码噪声让**几乎所有**像素差 1~2；
// 运镜让**边缘处**的像素差几十、平坦处几乎不差。平均值把这个差别抹平了。
//
// 所以主用指标是**「变化幅度超过 DELTA 的像素占比」**：噪声几乎不越过 DELTA，
// 运镜/换场则有可观比例越过。区分度比平均值高一个量级。

import { spawnSync } from 'child_process'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'

/** 取某时刻单帧的灰度像素 */
export function frameGray(mp4: string, atSec: number): Buffer {
  const r = spawnSync(FFMPEG,
    ['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1', '-an',
      '-vf', 'format=gray', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
  const b = r.stdout as unknown as Buffer
  if (!b || b.length === 0) throw new Error(`取帧失败 @${atSec}s: ${String(r.stderr).slice(-300)}`)
  return b
}

/**
 * 两帧的平均绝对差（0..255）。
 * 经验区间：编码噪声 < 3；轻微运镜 5~40；换场 > 30。
 */
export function frameDiff(mp4: string, t1: number, t2: number): number {
  const a = frameGray(mp4, t1)
  const b = frameGray(mp4, t2)
  const n = Math.min(a.length, b.length)
  if (n === 0) throw new Error('空帧')
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i])
  return s / n
}

/** 编码噪声的上限（平均绝对差）。低于它视为「画面没变」。 */
export const NOISE_FLOOR = 3

/** 认定「这个像素真的变了」的幅度门槛。编码噪声通常在 1~3，取 12 留足余量。 */
const DELTA = 12

/**
 * 两帧之间「变化幅度超过 DELTA 的像素」占比 0..1。
 * 经验区间：静止画面 < 0.005；缓慢推近 > 0.05；换场 > 0.3。
 */
export function changedRatio(mp4: string, t1: number, t2: number): number {
  const a = frameGray(mp4, t1)
  const b = frameGray(mp4, t2)
  const n = Math.min(a.length, b.length)
  if (n === 0) throw new Error('空帧')
  let c = 0
  for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) > DELTA) c++
  return c / n
}

/** 静止画面的变化像素占比上限 */
export const STILL_RATIO = 0.01

/**
 * 某时刻画面里「暗到接近全黑」的像素占比 0..1。
 *
 * 开场碎裂验收用：碎片没飞到的地方是 remap 的 fill 黑，
 * 所以「开头一片黑、结尾几乎无黑」就是碎裂真的发生过的证据。
 */
export function darkRatio(mp4: string, atSec: number, threshold = 16): number {
  const a = frameGray(mp4, atSec)
  let c = 0
  for (let i = 0; i < a.length; i++) if (a[i] <= threshold) c++
  return c / a.length
}

/**
 * 相邻采样点之间变化像素占比的最小值。
 * 断言「全程都在动」用它——任何一段定格都会让某一对相邻采样跌到静止水平。
 *
 * 注意用**相邻**而非两两组合：缓慢运镜下相距近的两帧本来就差别小，
 * 两两取最小会把「相邻采样」的正常小差异当成定格。
 */
export function minAdjacentChangedRatio(mp4: string, times: number[]): number {
  let min = Infinity
  for (let i = 1; i < times.length; i++) {
    min = Math.min(min, changedRatio(mp4, times[i - 1], times[i]))
  }
  return min
}
