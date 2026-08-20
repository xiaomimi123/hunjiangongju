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
const PEAK_ALPHA = 190

/**
 * 位移峰值（像素）。水波纹的「浓」主要靠它，不是靠白环的亮度。
 * 22px 在 720×960 上是明显但不夸张的折射感；再大画面会开始「融化」。
 */
const DISPLACE_PX = 22

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
 * 环上的位移用**高斯的导数** u·exp(-u²)：环的前沿把像素往外推、后沿往回拉，
 * 这一推一拉才是「水面隆起又落下」的观感。单纯用高斯只会得到均匀外推，像放大镜不像水波。
 * 乘 NORM 让 DISPLACE_PX 就是实际的峰值位移量，方便调。
 *
 * 输出是 8 位图，128 表示零位移，所以最终值 = 128 + 位移。
 */
export function rippleDisplaceExpr(o: RippleAssetOpts, axis: 'x' | 'y'): string {
  const d = o.durationMs / 1000
  const cx = Math.round(o.width / 2)
  const cy = Math.round(o.height / 2)
  const maxR = Math.ceil(Math.hypot(o.width, o.height) / 2) + R0
  // u*exp(-u^2) 的极值在 u=1/√2 处约 0.4289；除以它，DISPLACE_PX 才是真正的峰值
  const NORM = (1 / 0.4289).toFixed(3)
  const proj = axis === 'x' ? `(X-${cx})` : `(Y-${cy})`
  const terms: string[] = []
  for (let i = 0; i < Math.max(0, o.rings); i++) {
    const st = Math.round(d * 0.18 * i * 1000) / 1000
    const span = Math.max(0.05, Math.round((d - st) * 1000) / 1000)
    const p = `st(1,clip((T-${st})/${span},0,1))`
    const u = `st(2,(ld(0)-(${R0}+ld(1)*${maxR}))/${RING_W})`
    const gate = `gt(ld(1),0)*lt(ld(1),1)`
    terms.push(`(${p}*0+${u}*0+${gate}*(1-ld(1))*${DISPLACE_PX}*${NORM}*ld(2)*exp(-ld(2)*ld(2)))`)
  }
  if (terms.length === 0) return '128'
  const sum = terms.join('+')
  // 除以距离做径向投影；max(...,1) 防中心除零
  return `st(0,hypot(X-${cx},Y-${cy}))*0+128+(${sum})*${proj}/max(ld(0),1)`
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
