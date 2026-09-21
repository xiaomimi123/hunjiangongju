// 积分厘分换算（客户端安全版）：与 packages/db/src/credits.ts 同规则。
// 接口下发的积分字段一律是 cc（0.01 积分整数单位），页面展示前必须过 formatCredits。
export const CREDIT_SCALE = 100

export function formatCredits(cc: number): string {
  const v = cc / CREDIT_SCALE
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')
}
