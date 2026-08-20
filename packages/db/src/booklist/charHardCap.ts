// 文案字数**硬上限**：只有超过它才裁剪。
//
// 软预算(框架的 maxTotalChars)是「告诉 AI 的目标」,写超一点点不该被裁 ——
// 裁剪是从尾部整行丢弃,丢掉的正是收尾句,听感上就是「话没说完就结束了」。
// 硬上限由 30 秒成片时长反推(见 draftCharBudget.ts),超了才动刀。

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}

/**
 * 从 overlayTemplate 读硬上限。缺省/脏值 → null，调用方回退到软预算（即维持旧行为）。
 * 低于软预算的值一律忽略：那会让 AI 刚好写到目标就被裁。
 */
export function readCharHardCap(overlayTemplate: unknown, softBudget: number): number | null {
  const v = obj(overlayTemplate).__charHardCap
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null
  return Math.max(v, softBudget)
}
