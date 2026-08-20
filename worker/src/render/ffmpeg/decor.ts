// 装饰层与调色：压暗底(scrim) / 暗角(vignette) / 颗粒(grain) / 调色(grade)。
//
// 对应 HyperFrames 模板里的 `.scrim`、`.vignette`、`.grain` 与 grade.ts。
// 这几层没有任何逐条差异——同一个框架的每条片子都一样——所以能纯靠滤镜表达，
// 不需要预渲染素材。
//
// 纯函数：只拼字符串。

export interface GradeOpts {
  /** 与 grade.ts 同义：0 表示不调 */
  contrast?: number
  brightness?: number
  saturation?: number
  sharpen?: boolean
}

export interface DecorOpts {
  width: number
  height: number
  /** 压暗底高度(px)；0 = 不加。模板里是 340px */
  scrimHeightPx: number
  /** 压暗底最深处的不透明度 0..1 */
  scrimAlpha: number
  vignette: boolean
  grain: boolean
  grade?: GradeOpts
}

function r3(x: number): number {
  return Math.round(x * 1000) / 1000
}

/**
 * 调色链。空配置返回空串——**不要**产出 `eq=contrast=1:...` 这种恒等滤镜：
 * 每一个滤镜实例都是一次全帧重采样，1 万条/天的量级下白付的成本很实在。
 */
export function gradeChain(g?: GradeOpts): string {
  if (!g) return ''
  const parts: string[] = []
  const eq: string[] = []
  // eq 的中性值：contrast/saturation 是 1，brightness 是 0。
  // 我们的参数是「相对增量」，所以要各自换算到 eq 的坐标系。
  if (typeof g.contrast === 'number' && g.contrast !== 0) eq.push(`contrast=${r3(1 + g.contrast)}`)
  if (typeof g.brightness === 'number' && g.brightness !== 0) eq.push(`brightness=${r3(g.brightness)}`)
  if (typeof g.saturation === 'number' && g.saturation !== 0) eq.push(`saturation=${r3(1 + g.saturation)}`)
  if (eq.length) parts.push(`eq=${eq.join(':')}`)
  // 锐化放在 eq 之后：先定调再提细节，反过来会把调色引入的噪点一起锐化出来
  if (g.sharpen) parts.push('unsharp=5:5:0.8:5:5:0')
  return parts.join(',')
}

/**
 * 装饰链 + 压暗底。
 *
 * 顺序是有讲究的，改动前想清楚：
 *   调色 → 颗粒 → 暗角 → 压暗底
 * 调色最先（它定的是画面基调）；颗粒在暗角之前，否则暗角会把边缘的颗粒一起压掉、
 * 中心与边缘的颗粒密度不一致；压暗底最后，它的作用是保证字幕可读，
 * 被暗角再压一次会让底部过黑。
 *
 * 字幕不在这里——字幕由 ASS 在**这一层之后**烧，所以压暗底确实压在字幕下面。
 *
 * @param inLabel  上游标签（不带方括号）
 * @param outLabel 产出标签（不带方括号）
 * @param scrimInputIndex 压暗底所用 lavfi 输入的下标；scrimHeightPx>0 时必须给
 */
export function buildDecorChain(
  inLabel: string,
  outLabel: string,
  o: DecorOpts,
  scrimInputIndex?: number,
): { inputArgs: string[]; chain: string } {
  const fx: string[] = []
  const g = gradeChain(o.grade)
  if (g) fx.push(g)
  // 颗粒：alls=6 是很轻的量，对应模板里 0.06 不透明度的颗粒层；
  // allf=t 让噪点逐帧变化（静态噪点看起来像脏镜头，不像胶片）
  if (o.grain) fx.push('noise=alls=6:allf=t')
  // 暗角：PI/5 比默认 PI/5 更收敛一点，接近模板里「42% 之外开始压暗」的观感
  if (o.vignette) fx.push('vignette=PI/5')

  const useScrim = o.scrimHeightPx > 0 && o.scrimAlpha > 0
  if (!useScrim) {
    // 没有任何装饰时也要产出 outLabel，否则调用方的图会断链
    const chain = fx.length ? `[${inLabel}]${fx.join(',')}[${outLabel}]` : `[${inLabel}]null[${outLabel}]`
    return { inputArgs: [], chain }
  }

  if (typeof scrimInputIndex !== 'number') {
    throw new Error('scrimHeightPx>0 时必须提供 scrimInputIndex')
  }

  const h = Math.round(o.scrimHeightPx)
  const maxA = Math.round(Math.max(0, Math.min(1, o.scrimAlpha)) * 255)
  // 压暗底用 lavfi 现造：黑色 + 自上而下线性升高的 alpha。
  // geq 在**这张小图**上只求值一次（-loop 之后每帧复用同一张），
  // 不要把 geq 直接作用在正片上——那是逐帧逐像素求值，慢得离谱。
  const inputArgs = [
    '-f', 'lavfi',
    '-i', `color=c=black:s=${o.width}x${h},format=rgba,geq=r=0:g=0:b=0:a='${maxA}*Y/H'`,
  ]
  const pre = fx.length ? `${fx.join(',')},` : ''
  const chain =
    `[${inLabel}]${pre}format=yuv420p[dec_${outLabel}];` +
    `[dec_${outLabel}][${scrimInputIndex}:v]overlay=x=0:y=${o.height - h}:shortest=1[${outLabel}]`
  return { inputArgs, chain }
}
