// 渲染器选择（灰度开关）。
//
// 两条渲染路径产出同一份契约的 body.mp4，切换是安全的。
//
// **默认走 ffmpeg**。一开始默认留在 HyperFrames 是为了「发版不改变存量框架的成片」，
// 但实测下来这个保守默认的代价更大：
//   1. 每条片子 28.8 核·分钟 vs 3.4，差 8 倍，量级目标根本压不住
//   2. 开关只能写在 overlayTemplate 的 JSON 里，而后台编辑页保存时会把整个
//      overlayTemplate 覆写回去 —— 用 SQL 设好的开关被一次「保存」就抹掉了，
//      线上实测发生过一次（框架 260bb31a）
// 新渲染器的画面已逐帧验收过，没有理由继续让它当少数派。
//
// **HyperFrames 没有删也不能删**：开场碎裂那 2.16 秒仍由它渲——
// 碎片要带着本条片子自己的图，ffmpeg 目前给不出来（见迁移设计文档阶段 3）。
// 这里切换的是「正片+快闪走哪条路」，不是「要不要用 HyperFrames」。

export type RendererId = 'hyperframes' | 'ffmpeg'

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}

/**
 * 从 overlayTemplate 读 __renderer。
 * **只有显式写 'hyperframes' 才退回旧渲染器**；缺省与脏值一律走 ffmpeg。
 * 脏值不回退到旧渲染器是有意的：写错开关不该把整条线悄悄切走。
 */
export function readRenderer(overlayTemplate: unknown): RendererId {
  return obj(overlayTemplate).__renderer === 'hyperframes' ? 'hyperframes' : 'ffmpeg'
}
