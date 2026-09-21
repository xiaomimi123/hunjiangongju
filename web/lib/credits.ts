// 积分厘分换算（客户端安全版）：与 packages/db/src/credits.ts 同规则。
// 接口下发的积分字段一律是 cc（0.01 积分整数单位），页面展示前必须过 formatCredits。
export const CREDIT_SCALE = 100

export function formatCredits(cc: number): string {
  // 恒定两位小数（22.00 / 0.08 / 1.50）：小数积分时代统一金额式显示，
  // 不做「整数省零」——时有时无的小数位反而让学员困惑
  return (cc / CREDIT_SCALE).toFixed(2)
}
