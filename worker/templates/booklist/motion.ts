// 运镜库 + 转场库。全部产出字面量 GSAP tween 字符串（seek-safe，无 function-based 值）。
import { sec, esc } from './util.js'

export type MoveId = 'push-in' | 'pull-back' | 'pan-right' | 'pan-left' | 'drift-up' | 'tilt-settle'
export const MOVES: MoveId[] = ['push-in', 'pull-back', 'pan-right', 'pan-left', 'drift-up', 'tilt-settle']

export function pickMove(seqNo: number, offset: number, moves?: string[]): MoveId {
  const valid = (moves ?? []).filter((m): m is MoveId => (MOVES as string[]).includes(m))
  if (valid.length > 0) return valid[((seqNo % valid.length) + valid.length) % valid.length]
  return MOVES[(((seqNo + offset) % MOVES.length) + MOVES.length) % MOVES.length]
}

/**
 * 场景运镜：对 .sN .photo 施加跨整段时间窗的缓慢位移/缩放。
 * pushDur 比段长多 1.2s，保证段末仍在运动（避免定格死板）。所有值字面量。
 * .photo 有 inset:-30px 余量，横摇/上移的 ±24px 不会露底。
 */
export function moveTweens(move: MoveId, n: number, startMs: number, endMs: number, isLast: boolean, baseScale = 1.07): string {
  const startSec = sec(startMs)
  const segLenSec = Math.max(0.1, sec(endMs - startMs))
  const dur = Math.round((segLenSec + 1.2) * 1000) / 1000
  const sel = `'.s${n} .photo'`
  const t = (from: string, to: string) =>
    `  tl.fromTo(${sel}, ${from}, { ${to}, duration: ${dur}, ease: 'sine.inOut' }, ${startSec});`
  const B = baseScale
  const r = (x: number) => Math.round(x * 1000) / 1000
  switch (move) {
    case 'push-in':
      return t(`{ scale: ${r(B - 0.035)} }`, `scale: ${r(isLast ? B + 0.09 : B + 0.035)}`)
    case 'pull-back':
      return t(`{ scale: ${r(isLast ? B + 0.13 : B + 0.07)} }`, `scale: ${r(B - 0.03)}`)
    case 'pan-right':
      return t(`{ scale: ${r(B + 0.03)}, x: -24 }`, `x: 24`)
    case 'pan-left':
      return t(`{ scale: ${r(B + 0.03)}, x: 24 }`, `x: -24`)
    case 'drift-up':
      return t(`{ scale: ${r(B + 0.03)}, y: 24 }`, `y: -24`)
    case 'tilt-settle':
      return t(`{ scale: ${r(B + 0.05)}, rotation: -2 }`, `scale: ${r(B - 0.01)}, rotation: 0`)
  }
}

/** 草稿关键帧提取出的运镜数值（阶段1只支持缩放，理由见 keyframeTween 注释） */
export interface KeyframeMotion {
  scaleFrom: number
  scaleTo: number
}

/**
 * 照抄草稿关键帧的运镜。与 moveTweens 的「预设招式 + 硬编码幅度」不同，这里直接用实测数值。
 *
 * 三处刻意的差异（都是为了贴近剪映的真实行为）：
 * 1. duration 恰为段长——moveTweens 用「段长 + 1.2s」的过冲来避免段末定格，
 *    但剪映关键帧就是覆盖整段、到点即停，过冲反而不像原片。
 * 2. ease 用 'none'（线性）——实测关键帧的 left_control/right_control 均为 (0,0)，即线性插值，
 *    而 moveTweens 用的是 sine.inOut。
 * 3. 起止值直接取实测——如样例正片三段是 1.0→1.107571 / 1.082490 / 1.105659，
 *    而 moveTweens 的 push-in 是 baseScale-0.035 → baseScale+0.035（默认即 1.035→1.105），
 *    起点终点都不同。
 *
 * 【只支持缩放】样例三段的 Rotation/PositionX/PositionY 关键帧全是 0→0（存在但未动画），
 * 无法据此确定剪映这些字段的单位（旋转是度还是弧度、位移是归一化还是像素）。没有可验证的
 * 样本就实现换算等于凭空猜，一旦猜错是静默的画面错位。故本阶段只做缩放，遇到真有位移/旋转
 * 的工程时再补，并在保真度报告里如实记为未复刻。
 */
export function keyframeTween(m: KeyframeMotion, n: number, startMs: number, endMs: number): string {
  const segLenSec = sec(endMs - startMs)
  if (segLenSec <= 0) return ''
  const r = (x: number) => Math.round(x * 1000) / 1000
  const from = r(m.scaleFrom)
  const to = r(m.scaleTo)
  // 首尾相同=该段没有运镜动画，但可能仍有静态缩放（剪映里 clip.scale 不为 1、只是没打关键帧）。
  // 此时必须出一条 tl.set 把静态缩放钉住，否则画面会回到 scale 1、把创作者的构图丢掉。
  // 恰为 1 时无需任何 transform，返回空串。
  if (from === to) return from === 1 ? '' : `  tl.set('.s${n} .photo', { scale: ${from} }, ${sec(startMs)});`
  return `  tl.fromTo('.s${n} .photo', { scale: ${from} }, { scale: ${to}, duration: ${segLenSec}, ease: 'none' }, ${sec(startMs)});`
}

export type TransId = 'crossfade' | 'wipe' | 'shard' | 'glide-push' | 'blur-dissolve'
export const TRANS: TransId[] = ['crossfade', 'wipe', 'shard', 'glide-push', 'blur-dissolve']

export function pickTrans(seqNo: number, offset: number): TransId {
  return TRANS[(((seqNo + offset) % TRANS.length) + TRANS.length) % TRANS.length]
}

export const DEFAULT_TRANS_WINDOW = 0.72 // crossfade 窗口秒数（所有转场共用默认值，不占额外时长）

/**
 * 进入场景 n（上一场景 n-1）的转场，全部落在 boundarySec 起的 windowSec 窗内。
 * windowSec 缺省=DEFAULT_TRANS_WINDOW，保证不传参数时输出与改动前逐字节一致
 * （剪映工程提取到 transition.durationMs 时由调用方传入覆盖，见 indexHtml.ts flash 分支）。
 */
export function transTweens(trans: TransId, n: number, boundaryMs: number, windowSec: number = DEFAULT_TRANS_WINDOW): string {
  const b = sec(boundaryMs)
  const w = windowSec
  const nw = `'.s${n}'`
  const pv = `'.s${n - 1}'`
  const lines: string[] = []
  switch (trans) {
    case 'crossfade':
      lines.push(`  tl.fromTo(${nw}, { opacity: 0 }, { opacity: 1, duration: ${w}, ease: 'sine.inOut' }, ${b});`)
      lines.push(`  tl.to(${pv}, { opacity: 0, duration: ${w}, ease: 'sine.inOut' }, ${b});`)
      break
    case 'wipe':
      lines.push(`  tl.set(${nw}, { opacity: 1 }, ${b});`)
      lines.push(`  tl.fromTo(${nw}, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: ${w}, ease: 'power2.inOut' }, ${b});`)
      lines.push(`  tl.set(${pv}, { opacity: 0 }, ${Math.round((b + w) * 1000) / 1000});`)
      break
    case 'shard':
      lines.push(`  tl.fromTo(${nw}, { opacity: 0 }, { opacity: 1, duration: ${w}, ease: 'sine.inOut' }, ${b});`)
      lines.push(`  tl.set(${pv}, { opacity: 0 }, ${b});`)
      lines.push(shardTransTweens(n, boundaryMs, w))
      break
    case 'glide-push':
      lines.push(`  tl.set(${nw}, { opacity: 1 }, ${b});`)
      lines.push(`  tl.fromTo(${nw}, { xPercent: 100 }, { xPercent: 0, duration: ${w}, ease: 'power3.out' }, ${b});`)
      lines.push(`  tl.to(${pv}, { xPercent: -40, opacity: 0, duration: ${w}, ease: 'power3.out' }, ${b});`)
      break
    case 'blur-dissolve':
      lines.push(`  tl.fromTo(${nw}, { opacity: 0, filter: 'blur(18px)' }, { opacity: 1, filter: 'blur(0px)', duration: ${w}, ease: 'sine.inOut' }, ${b});`)
      lines.push(`  tl.to(${pv}, { opacity: 0, filter: 'blur(18px)', duration: ${w}, ease: 'sine.inOut' }, ${b});`)
      break
  }
  return lines.join('\n')
}

/**
 * 碎片网格：把一张图切成 cols×rows 个 .shard 绝对定位块，每块用负偏移背景显示自己那格。
 * startScattered=true 时把「打散」初始 transform/opacity 烘焙进内联（GSAP 只 to 归位，seek-safe）。
 */
export function shardGrid(opts: {
  containerClass: string
  imgSrc: string
  cols: number
  rows: number
  width: number
  height: number
  startScattered?: boolean
}): string {
  const { containerClass, imgSrc, cols, rows, width, height, startScattered } = opts
  const cellW = width / cols
  const cellH = height / rows
  const shards: string[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const left = Math.round(c * cellW)
      const top = Math.round(r * cellH)
      const w = Math.round(cellW) + 1
      const h = Math.round(cellH) + 1
      let scatter = ''
      if (startScattered) {
        const dx = Math.round(Math.sin(idx * 1.7) * 240 + (idx % 2 === 0 ? 70 : -70))
        const dy = Math.round(Math.cos(idx * 2.1) * 200 - 30)
        const dr = Math.round(Math.sin(idx * 3.3) * 55)
        scatter = `transform:translate(${dx}px,${dy}px) rotate(${dr}deg) scale(1.15);opacity:0.15;`
      }
      shards.push(
        `      <div class="shard" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;` +
          `background-image:url('${esc(imgSrc)}');background-size:${width}px ${height}px;` +
          `background-position:-${left}px -${top}px;${scatter}"></div>`,
      )
    }
  }
  return `    <div class="${containerClass}" data-layout-ignore>\n${shards.join('\n')}\n    </div>`
}

/** 首场景玻璃碎片开场：t=0 起碎片 stagger 归位，0.82s 真实图淡入接手，0.88s 碎片层淡出。 */
export function shardOpeningTweens(): string {
  return [
    `  tl.set('.s1 .photo', { opacity: 0 }, 0);`,
    `  tl.to('.s1shatter .shard', { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.65, ease: 'power3.out', stagger: { amount: 0.45, from: 'center' } }, 0);`,
    `  tl.to('.s1 .photo', { opacity: 1, duration: 0.2, ease: 'sine.inOut' }, 0.82);`,
    `  tl.to('.s1shatter', { opacity: 0, duration: 0.25, ease: 'sine.inOut' }, 0.88);`,
  ].join('\n')
}

/** shard 转场：上一场景碎片层随 crossfade 同刻碎裂散开。windowSec 缺省=DEFAULT_TRANS_WINDOW，与 transTweens 的窗口保持一致。 */
export function shardTransTweens(n: number, boundaryMs: number, windowSec: number = DEFAULT_TRANS_WINDOW): string {
  const b = sec(boundaryMs)
  const hideAt = Math.round((b + windowSec) * 1000) / 1000
  return [
    `  tl.set('.ts${n}', { opacity: 1 }, ${b});`,
    `  tl.to('.ts${n} .shard', { scale: 1.3, y: -50, rotation: 12, opacity: 0, duration: 0.5, ease: 'power1.in', stagger: { amount: 0.26, from: 'edges' } }, ${b});`,
    `  tl.set('.ts${n}', { opacity: 0 }, ${hideAt});`,
  ].join('\n')
}
