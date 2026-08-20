// 水波纹装饰层：**预渲染一次、每条片子复用**。
//
// 它是纯装饰——同一个框架的每条片子里长得一模一样，与文案、配图、时长都无关。
// 所以不该逐条渲：渲成一串带透明通道的 PNG 存起来，每条片子只付一次 overlay 的钱。
// 这也是 HyperFrames 降级为「模板资产预渲染器」之后，第一个真正落到这个形态上的效果。
//
// 用 geq 逐像素画同心圆环。geq 很慢（每像素求值一次表达式），但**这里不在乎**：
// 一个模板只跑一次，之后永远是复用。反过来，绝对不能把 geq 放进逐条片子的滤镜链里。
//
// 【两层叠加】
//   1. 位移层：用 ffmpeg 的 displace 滤镜按位移图**真的把画面像素推开**——
//      这才是水波纹的本体，环经过之处底图会被折射扭曲。
//      (CSS 时代做不到这一点，只能画发光圆环充数；迁到 ffmpeg 后不必再将就。)
//   2. 高光层：叠一圈半透明白环，让波峰有反光。单靠位移在低对比度画面上看不出来。
//
// 位移图与高光图都是**预渲染一次、每条片子复用**——它们与文案、配图、时长都无关。

export interface RippleAssetOpts {
  width: number
  height: number
  fps: number
  durationMs: number
  /** 圆环数。3 环足够读出「一圈追一圈」，再多在 458ms 内会糊成一片 */
  rings: number
  /** 输出 PNG 序列的模式串，如 /path/ripple/%03d.png */
  outPattern: string
}

/**
 * 环的起始半径(px)、线宽(px)与峰值不透明度。
 *
 * 第一版 RING_W=26 / 峰值 255 实测太重：白得发光、粗得像「传送门」，
 * 不像水纹。水波纹的观感靠**细、淡、多圈**，不靠亮。
 */
const R0 = 24
const RING_W = 15
/**
 * 高光环的峰值不透明度。位移层改成正弦波场之后，画面自身的扭曲已经足够明显，
 * 白环退成很淡的辅助反光即可；再亮就会盖住底图的水面感，变回「画了一圈白圈」。
 */
const PEAK_ALPHA = 70

/**
 * 位移峰值（像素）。水波纹的「浓」全靠它，不是靠白环的亮度。
 * 波场是多圈叠加的，单圈振幅不必很大就有明显的水面感；再大画面会开始「融化」。
 */
const DISPLACE_PX = 16

/** 波长（像素）。720×960 的对角线半径约 600，取 95 时同时能看到六七圈波。 */
const WAVE_LEN = 95

/** 整段时长里波向外跑过几个波长。越大波跑得越快。 */
const WAVE_CYCLES = 2.2

/**
 * 构造 alpha 通道表达式。
 *
 * geq 的表达式语言没有局部变量，但有 st(idx,值)/ld(idx) 这对存取函数——
 * 不用它的话每个环要把进度表达式原样重复三次，串会长到没法读也没法改。
 *
 * 每个环：
 *   进度 P = clip((T - 起始) / (总时长 - 起始), 0, 1)
 *   半径 R = R0 + P * 最大半径
 *   透明度按 (1-P) 衰减，径向用高斯，让边缘柔和而不是硬边
 * 三个环取最大值叠加。
 */
export function rippleAlphaExpr(o: RippleAssetOpts): string {
  const d = o.durationMs / 1000
  const cx = Math.round(o.width / 2)
  const cy = Math.round(o.height / 2)
  // 最大半径要盖过对角线，否则环还没出画面就消失了
  const maxR = Math.ceil(Math.hypot(o.width, o.height) / 2) + R0
  const parts: string[] = []
  // st(0) 存当前像素到中心的距离，三个环共用，省两次 hypot
  const head = `st(0,hypot(X-${cx},Y-${cy}))`
  for (let i = 0; i < Math.max(0, o.rings); i++) {
    const s = Math.round(d * 0.18 * i * 1000) / 1000
    const span = Math.max(0.05, Math.round((d - s) * 1000) / 1000)
    // st(1) 存本环进度；clip 保证 T 落在起始之前时为 0、超出时为 1
    const p = `st(1,clip((T-${s})/${span},0,1))`
    const r = `(${R0}+ld(1)*${maxR})`
    const fall = `exp(-pow((ld(0)-${r})/${RING_W},2))`
    // 进度为 0 时不显示（环还没起步），否则三个环会在 t=0 挤在圆心
    const gate = `gt(ld(1),0)*lt(ld(1),1)`
    parts.push(`(${p}*0+${gate}*(1-ld(1))*${PEAK_ALPHA}*${fall})`)
  }
  if (parts.length === 0) return '0'
  // 逐个取 max：环之间是叠加关系，取和会在交叠处过曝成一片白
  let expr = parts[0]
  for (let i = 1; i < parts.length; i++) expr = `max(${expr},${parts[i]})`
  return `${head}*0+${expr}`
}

/**
 * 位移图的表达式（x 或 y 轴）。
 *
 * ── 形态：正弦波场，不是单个冲击环 ──
 *
 * 第一版用「高斯环」——一圈鼓包向外扩，环外画面纹丝不动。那是「一滴水砸下去」的冲击环，
 * 不是剪映的水波纹。剪映那个效果是**整幅画面像水面一样起伏**，同一时刻能看到好几圈波，
 * 而且波是连续向外跑的。差别在这里，不在浓淡。
 *
 * 所以位移改成径向正弦波场：
 *   相位 φ = 距离/波长 − 时间/周期     （相位随时间推移 ⇒ 波向外跑）
 *   位移 dr = 振幅 × 衰减(t) × sin(2πφ)
 * 波长取 WAVE_LEN，整幅 720×960 上同时能看到六七圈；衰减让它在 458ms 内自然平息。
 *
 * 输出是 8 位图，128 表示零位移，最终值 = 128 + 位移。
 */
export function rippleDisplaceExpr(o: RippleAssetOpts, axis: 'x' | 'y'): string {
  if (o.rings <= 0) return '128'
  const d = o.durationMs / 1000
  const cx = Math.round(o.width / 2)
  const cy = Math.round(o.height / 2)
  const proj = axis === 'x' ? `(X-${cx})` : `(Y-${cy})`
  // 波从中心往外跑：整段时长里跑过 WAVE_CYCLES 个波长
  const period = (d / WAVE_CYCLES).toFixed(4)
  // 振幅随时间线性平息；再乘一个「离中心越远越弱」的软衰减，避免边角过度撕扯
  const env = `(1-clip(T/${d.toFixed(4)},0,1))`
  const fall = `exp(-ld(0)/${(Math.hypot(o.width, o.height) * 0.55).toFixed(1)})`
  const phase = `(ld(0)/${WAVE_LEN}-T/${period})`
  const dr = `${DISPLACE_PX}*${env}*${fall}*sin(2*PI*${phase})`
  return `st(0,hypot(X-${cx},Y-${cy}))*0+128+(${dr})*${proj}/max(ld(0),1)`
}

/**
 * 位移图预渲染命令（每轴一条）。
 * 必须用 gbrp：displace 逐平面取位移，三个通道要写同一个值。
 */
export function buildRippleDisplaceArgs(o: RippleAssetOpts, axis: 'x' | 'y', outPattern: string): string[] {
  const e = rippleDisplaceExpr(o, axis)
  return [
    '-y', '-f', 'lavfi',
    '-i', `color=c=gray:s=${o.width}x${o.height}:r=${o.fps}:d=${(o.durationMs / 1000).toFixed(3)}`,
    '-vf', `format=gbrp,geq=r='${e}':g='${e}':b='${e}'`,
    outPattern,
  ]
}

/**
 * 位移层的滤镜链。`enable` 之外的时间 displace 直接透传输入，不影响画面。
 * edge=smear：环扫到画面边缘时用边缘像素填充，比 blank(黑边)/wrap(穿帮)自然。
 */
export function rippleDisplaceChain(
  inLabel: string,
  outLabel: string,
  xIndex: number,
  yIndex: number,
  atMs: number,
  durationMs: number,
): string {
  const a = Math.round(atMs) / 1000
  const b = Math.round(atMs + durationMs) / 1000
  return (
    `[${xIndex}:v]setpts=PTS-STARTPTS+${a}/TB[rpx];` +
    `[${yIndex}:v]setpts=PTS-STARTPTS+${a}/TB[rpy];` +
    `[${inLabel}][rpx][rpy]displace=edge=smear:enable='between(t,${a},${b})'[${outLabel}]`
  )
}

/** 高光环预渲染命令：产出一串 RGBA PNG。跑一次即可，产物入库长期复用。 */
export function buildRippleAssetArgs(o: RippleAssetOpts): string[] {
  const d = (o.durationMs / 1000).toFixed(3)
  return [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=white:s=${o.width}x${o.height}:r=${o.fps}:d=${d}`,
    '-vf', `format=rgba,geq=r=255:g=255:b=255:a='${rippleAlphaExpr(o)}'`,
    o.outPattern,
  ]
}

/**
 * 把预渲染好的水波纹叠到正片上。
 *
 * @param inputIndex PNG 序列在输入里的下标
 * @param atMs 起点（片段本地时间）
 *
 * `setpts` 把序列整体平移到 atMs；`enable` 限定只在这段窗口内合成——
 * 少了 enable 的话，序列播完之后 overlay 会**一直用最后一帧**，
 * 而最后一帧是「环已扩散到画外、alpha 接近 0」，虽然看不出来，
 * 但整片剩余时间都在白付一次 overlay 的合成成本。
 */
export function rippleOverlayChain(
  inLabel: string,
  outLabel: string,
  inputIndex: number,
  atMs: number,
  durationMs: number,
): string {
  const a = Math.round(atMs) / 1000
  const b = Math.round(atMs + durationMs) / 1000
  return (
    `[${inputIndex}:v]setpts=PTS-STARTPTS+${a}/TB[rp];` +
    `[${inLabel}][rp]overlay=x=0:y=0:eof_action=pass:enable='between(t,${a},${b})'[${outLabel}]`
  )
}
