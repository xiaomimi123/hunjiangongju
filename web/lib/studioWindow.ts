/**
 * 剪辑工作台的「可编辑窗口」判定。
 *
 * 用户拍板的口径：**渲完、未发布之前**可以改；已发布的锁死（要改先取消发布）。
 * 另外保留素材就绪（ASSET_READY）这个原有的编辑窗口——那是合成之前的人工介入点，
 * 工作台在那里同样该能用。
 *
 * 抽成一个函数而不是在三个路由里各写一遍：这类判定一旦分头维护必然漂移
 * （taskAccess.ts 的注释里记着同一个仓库上一次漂移的经过）。
 */

/** 渲染任务停在这些状态时，成片已经产出（或已失败），可以回头改 */
const RENDERED = ['PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED', 'QC_FAILED', 'EXPORTED', 'FAILED']

export interface StudioTaskShape {
  status: string
  published: boolean
  renderTasks: { status: string }[]
}

/**
 * @param task 需带上**最新一条** renderTask（`orderBy: {createdAt:'desc'}, take: 1`）
 * @returns 可编辑时返回 null；不可编辑时返回给运营看的原因
 */
export function studioBlockReason(task: StudioTaskShape): string | null {
  if (task.published) return '已发布的成片不可修改，请先取消发布'
  if (task.status === 'ASSET_READY') return null
  const latest = task.renderTasks[0]
  if (!latest) return '尚未生成，等素材就绪后再来'
  if (!RENDERED.includes(latest.status)) return '正在合成中，等这一轮跑完再改'
  return null
}
