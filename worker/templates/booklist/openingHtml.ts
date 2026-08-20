// 只渲「开场碎裂」那一小段的页面。
//
// 混合方案里 HyperFrames 只保留这 2 秒多——碎片必须**带着本条片子自己的图**，
// 这是 ffmpeg 滤镜给不出来的（预渲染成固定素材也不行，每条片子的图都不同）。
// 其余 90% 的片长交给 ffmpeg，成本从 28.8 核·分钟降到 3.4。
//
// 与完整模板的区别：不含快闪、正片、字幕、水印——那些都由 ffmpeg 负责。
// 页面只输出一个碎片层 + 一张底图，时长就是开场时长。

import { baseCss, sceneHtml } from './layout.js'
import { rootVarsCss, type PresetId } from './theme.js'
import { shatterAssembleHtml, shatterAssembleCss, shatterAssembleTweens } from './shatterAssemble.js'
import { sec } from './util.js'

export interface OpeningOpts {
  imgSrc: string
  width: number
  height: number
  durationMs: number
  preset: PresetId
}

export function openingIndexHtml(o: OpeningOpts): string {
  const dur = sec(o.durationMs)
  // 碎片在 78% 处合拢，之后把画面交给底图静置到段末——
  // 与 shatterAssembleTweens 内部的 assembleEnd 保持一致。
  const handover = Math.round(o.durationMs * 0.8) / 1000
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8" />
<meta name="viewport" content="width=${o.width}, height=${o.height}" />
<title>booklist opening</title>
<style>
${rootVarsCss(o.preset)}
${baseCss(o.preset)}
${shatterAssembleCss()}
.scene { opacity: 1; }
</style></head>
<body>
<main id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="${o.width}" data-height="${o.height}">
${sceneHtml(1, o.imgSrc)}
${shatterAssembleHtml({ containerClass: 'shatter-assemble', imgSrc: o.imgSrc, width: o.width, height: o.height })}
</main>
<script src="gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  var tl = gsap.timeline({ paused: true });
  tl.set('.s1 .photo', { opacity: 0 }, 0);
  tl.to('.s1 .photo', { opacity: 1, duration: 0.2, ease: 'sine.inOut' }, ${handover});
${shatterAssembleTweens(o.durationMs)}
  window.__timelines["main"] = tl;
</script>
</body></html>
`
}
