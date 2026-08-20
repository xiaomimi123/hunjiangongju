// 渲染器选择（灰度开关）。
//
// 两条渲染路径产出同一份契约的 body.mp4，所以切换是安全的；默认留在 HyperFrames，
// 框架**显式**声明才走 ffmpeg。默认值站在「不动线上」那一侧：
// 新渲染器的画面与旧的有可感知差异（字号换算、开场形态、水波纹形态），
// 不该因为发了一版代码就让所有存量框架的成片变样。

export type RendererId = 'hyperframes' | 'ffmpeg'

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}

/** 从 overlayTemplate 读 __renderer。脏值/缺省一律回落 hyperframes。 */
export function readRenderer(overlayTemplate: unknown): RendererId {
  const v = obj(overlayTemplate).__renderer
  return v === 'ffmpeg' ? 'ffmpeg' : 'hyperframes'
}
