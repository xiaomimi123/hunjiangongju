import { pickSubset } from '@mixcut/db'
// 素材库接入的纯函数：按序分配素材给分镜、解析生成变量里的「配图来源」。

// 按序分配：assets[i] 给第 i 个分镜；分镜数超过素材数的部分为 null（null → 回退 AI 生图）；
// 不循环复用素材（即使素材更多也只取前 segCount 个，多余的忽略）。
/**
 * 给每个分镜分配一张素材库图片。
 *
 * 传 seed（用 genTaskId）时按**确定性随机**抽取：同任务重跑结果一致、不同任务必然不同。
 * 这是批量场景的必需品——原来的「按顺序取前 N 张」会让一天几千条片子全都拿到同样那几张图，
 * 素材库里存 500 张也没用。随机源复用仓库既有的 pickSubset（FNV-1a + LCG + Fisher-Yates），
 * 不用 Math.random()（本仓硬约束：随机一律由 genTaskId 派生，保证可复现）。
 *
 * 库存不足 segCount 时**循环复用**而非留 null——留 null 会让该段回退到 AI 生图，
 * 而消灭每条片子的生图调用正是引入素材库的目的。
 * 素材库为空时才全 null（此时确实只能回退 AI）。
 *
 * 不传 seed 时维持原「按顺序取」行为，保证老调用点零回归。
 */
export function pickAssetsForSegments<T>(assets: T[], segCount: number, seed?: string): (T | null)[] {
  if (assets.length === 0) return new Array(segCount).fill(null)
  if (seed === undefined) {
    const result: (T | null)[] = []
    for (let i = 0; i < segCount; i++) {
      result.push(i < assets.length ? assets[i] : null)
    }
    return result
  }
  // 整库洗牌后按下标取：库存 >= segCount 时段内不重复；不足时循环复用洗牌后的顺序，
  // 不会紧挨着重复同一张。
  const shuffled = pickSubset(assets, assets.length, seed)
  return Array.from({ length: segCount }, (_, i) => shuffled[i % shuffled.length])
}

// 解析生成任务 variables 里的「配图来源」：source==='library' 时才附带 folder（非空 trim 字符串）。
// 非法/缺省一律回退 'ai'（即维持现有全 AI 生图行为）。
export function readAssetSource(variables: unknown): { source: 'ai' | 'library'; folder?: string } {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return { source: 'ai' }
  const v = variables as Record<string, unknown>
  if (v.assetSource !== 'library') return { source: 'ai' }
  const folder = typeof v.assetFolder === 'string' ? v.assetFolder.trim() : ''
  return folder ? { source: 'library', folder } : { source: 'library' }
}
