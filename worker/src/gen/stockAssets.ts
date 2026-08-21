import { pickSubset, COVER_FOLDER_SUFFIX } from '@mixcut/db'
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

/**
 * 书封文件夹判定。剪映导入时快闪书封被放进 `<工程名>·书封`（COVER_FOLDER_SUFFIX）。
 *
 * 为什么要在抽取这一层再挡一道：分文件夹入库只有在**按文件夹过滤**时才有效。
 * 线上实测框架的素材文件夹是空的，查询退化成 `where kind='image'` —— 抽的是全库，
 * 挪进书封文件夹的那 9 张照样被正片抽中，等于分文件夹白做了。
 * 书封不该出现在正片里是条不变量，不能依赖运营有没有填对文件夹。
 */
export function isCoverFolder(folder: string | null | undefined): boolean {
  return typeof folder === 'string' && folder.endsWith(COVER_FOLDER_SUFFIX)
}

/**
 * 取某个槽位可用的素材池。
 * @param folder 指定文件夹则精确匹配；留空表示「全库」，此时排除书封文件夹。
 */
export function poolForFolder<T extends { folder: string | null }>(assets: T[], folder?: string): T[] {
  const want = (folder ?? '').trim()
  if (want) return assets.filter((a) => a.folder === want)
  return assets.filter((a) => !isCoverFolder(a.folder))
}

/**
 * 逐槽位决定「这一张从哪个素材文件夹抽」。
 *
 * 槽位自己的 folder 优先，其次是生成任务上的全局 folder。
 * 之前 readImageSlots 解析了 slot.folder，但 generateImage 从没读过它 ——
 * 后台能填、填了没用，属于静默失效。
 *
 * @returns 每个分镜的有效文件夹；该分镜不走素材库时为 null
 */
export function resolveSlotFolders(
  segCount: number,
  slotSourceAt: (i: number) => 'ai' | 'library' | undefined,
  slotFolderAt: (i: number) => string | undefined,
  globalSource: 'ai' | 'library',
  globalFolder?: string,
): (string | null)[] {
  return Array.from({ length: segCount }, (_, i) => {
    const src = slotSourceAt(i) ?? globalSource
    if (src !== 'library') return null
    return (slotFolderAt(i) ?? globalFolder ?? '').trim()
  })
}
