// 水波纹装饰层：**预渲染一次、每条片子复用**。
//
// 它是纯装饰——同一个框架的每条片子里长得一模一样，与文案、配图、时长都无关。
// 所以不该逐条渲：渲成一串带透明通道的 PNG 存起来，每条片子只付一次 overlay 的钱。
// 这也是 HyperFrames 降级为「模板资产预渲染器」之后，第一个真正落到这个形态上的效果。
//
// 用 geq 逐像素画同心圆环。geq 很慢（每像素求值一次表达式），但**这里不在乎**：
// 一个模板只跑一次，之后永远是复用。反过来，绝对不能把 geq 放进逐条片子的滤镜链里。
//
// 【明确的近似】真实水波纹是逐像素折射位移，这里画的是发光圆环扩散，只求氛围。
// 这是当初拍板时就接受的取舍，迁移到 ffmpeg 之后仍然是近似，不要当成像素级复刻。

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

/** 环的起始半径(px)与线宽(px)。线宽决定「水纹」的粗细手感 */
const R0 = 24
const RING_W = 26

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
    parts.push(`(${p}*0+${gate}*(1-ld(1))*255*${fall})`)
  }
  if (parts.length === 0) return '0'
  // 逐个取 max：环之间是叠加关系，取和会在交叠处过曝成一片白
  let expr = parts[0]
  for (let i = 1; i < parts.length; i++) expr = `max(${expr},${parts[i]})`
  return `${head}*0+${expr}`
}

/** 预渲染命令：产出一串 RGBA PNG。跑一次即可，产物入库长期复用。 */
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
