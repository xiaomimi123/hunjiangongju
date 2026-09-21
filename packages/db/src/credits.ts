// 积分厘分记账（2026-09-21 起）：数据库所有积分字段以「0.01 积分」为整数单位（下称 cc），
// 迁移 20260921000000 已把存量 ×100。原子扣退仍是整数运算，无浮点误差；显示层 /100。
// 服务端与客户端共用的纯函数——客户端镜像见 web/lib/credits.ts（不能 import 本文件，
// 会把 prisma 一串 Node-only 依赖打进浏览器包）。

export const CREDIT_SCALE = 100

/** cc → 展示字符串：300→"3"，8→"0.08"，150→"1.5" */
export function formatCredits(cc: number): string {
  const v = cc / CREDIT_SCALE
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')
}

/** 「积分」数值（可含两位小数）→ cc。非法/越界返回 null；上限 100 万积分防手滑 */
export function creditsToCc(credits: unknown): number | null {
  const n = typeof credits === 'string' ? Number(credits) : credits
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1_000_000) return null
  const cc = Math.round(n * CREDIT_SCALE)
  // 精度校验：0.001 这类超过两位小数的输入拒收（round 会静默吞掉，账目对不上用户输入）
  if (Math.abs(n * CREDIT_SCALE - cc) > 1e-6) return null
  return cc
}
