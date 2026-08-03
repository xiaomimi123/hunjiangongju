// 素材库接入的纯函数：按序分配素材给分镜、解析生成变量里的「配图来源」。

// 按序分配：assets[i] 给第 i 个分镜；分镜数超过素材数的部分为 null（null → 回退 AI 生图）；
// 不循环复用素材（即使素材更多也只取前 segCount 个，多余的忽略）。
export function pickAssetsForSegments<T>(assets: T[], segCount: number): (T | null)[] {
  const result: (T | null)[] = []
  for (let i = 0; i < segCount; i++) {
    result.push(i < assets.length ? assets[i] : null)
  }
  return result
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
