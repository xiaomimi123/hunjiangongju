// 特效层。目前只有水波纹一种。
//
// 客户样例里「水波纹」压在快闪→正片那一刀上（3.991s 起、458ms），与「一滴水滴声」
// （3.984s 起）配对出现——是给水滴音配的画面。此前 effect 轨从未被读过，这个效果一直缺席。
//
// 【明确的近似】真实的水波纹是逐像素折射位移，CSS 的 filter / mix-blend-mode 做不到
// （需要 SVG feDisplacementMap 或 WebGL）。这里用同心圆环扩散 + 轻微亮度起伏做氛围近似，
// 这是当初拍板时就接受的取舍（见 docs/superpowers/specs 的「水波纹类全屏特效 → CSS 近似版」）。
// 不要把它当成像素级复刻。
//
// 全部 tween 用字面量值（seek-safe：hyperframes 逐帧 seek 时间轴截图，函数式取值会失真）。

import { sec } from './util.js'

/** 圆环数。3 环足够读出「一圈圈荡开」，再多在 458ms 内会糊成一片 */
const RING_COUNT = 3

export function rippleHtml(): string {
  const rings = Array.from(
    { length: RING_COUNT },
    (_, i) => `      <div class="rp-ring rp${i + 1}"></div>`,
  ).join('\n')
  return `    <div class="ripple" data-layout-ignore>\n${rings}\n    </div>`
}

export function rippleCss(): string {
  return [
    // z-index 12：压在画面与暗角之上、字幕(13)之下——波纹不该盖住文字
    '.ripple{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:12;opacity:0;}',
    // 环从画面中心荡开。60px 起、放大 20 倍 = 1200px，超过 720×960 的对角线，能荡出画面。
    //
    // 亮边 + 暗边一起给：只用白环时，浅色配图上几乎看不见（实测第一版在雪景图上肉眼难辨）。
    // 真实水波也是波峰亮、波谷暗，一亮一暗反而更像，且在明暗两种底图上都成立。
    '.rp-ring{position:absolute;left:50%;top:50%;width:60px;height:60px;margin:-30px 0 0 -30px;' +
      'border-radius:50%;border:3px solid rgba(255,255,255,0.85);' +
      'box-shadow:0 0 0 2px rgba(0,0,0,0.22), 0 0 26px rgba(255,255,255,0.55), ' +
      'inset 0 0 26px rgba(0,0,0,0.3);' +
      'opacity:0;will-change:transform,opacity;}',
  ].join('\n')
}

/**
 * @param atMs   起点（绝对时间，调用方按 flashEnd + offsetMs 算好）
 * @param durationMs 总时长
 *
 * 时长为 0 或负 → 返回空串，不产出退化 tween。
 */
export function rippleTweens(atMs: number, durationMs: number): string {
  const total = durationMs / 1000
  if (!(total > 0)) return ''
  const at = sec(atMs)
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const lines: string[] = [`  tl.set('.ripple', { opacity: 1 }, ${at});`]

  for (let i = 0; i < RING_COUNT; i++) {
    // 错峰荡开：后一环晚 18% 总时长起步，形成「一圈追一圈」
    const start = r3(at + total * 0.18 * i)
    // 每环用满从自己起步到整体结束的剩余时间；至少 0.12s，避免末环几乎不动
    const dur = Math.max(0.12, r3(total - total * 0.18 * i))
    lines.push(
      `  tl.fromTo('.rp${i + 1}', { scale: 0.2, opacity: 1 }, ` +
        `{ scale: 20, opacity: 0, duration: ${dur}, ease: 'power2.out' }, ${start});`,
    )
  }
  // 整层收尾：荡完即隐藏，否则 opacity:1 的空层会一直留在时间轴上
  lines.push(`  tl.set('.ripple', { opacity: 0 }, ${r3(at + total)});`)
  return lines.join('\n')
}
