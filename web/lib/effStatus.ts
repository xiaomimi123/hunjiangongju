// 生成任务对**学员**展示的有效状态。
//
// 为什么不能直接用 generationTask.status：学员的 autoRender 任务在把渲染排进队列后，
// GenerationTask.status 就停在 `VISUAL_RENDERING` 不再前进了——真实进度
// （EXPORTED / QC_FAILED / FAILED …）记在最新的 RenderTask 上。
// 直接展示 status 的表现是「任务早就出片了，页面还一直显示画面渲染中」。
//
// 这个判断原先是 works 列表页里的一个局部函数，首页没用上，于是首页一直显示错的状态。
// 抽到这里就是为了让第三个页面没法再漏掉它。

export interface HasRenderTasks {
  status: string
  renderTasks: { status: string }[]
}

/** 最新 RenderTask 的状态优先；没有 RenderTask（还没排到渲染）才回退生成阶段状态。 */
export function effStatus(t: HasRenderTasks): string {
  return t.renderTasks[0]?.status ?? t.status
}

/** 漏斗分桶用的状态集合。渲染态与生成态混在同一张漏斗里，口径必须一处定义 */
const PROCESSING = ['GEN_CREATED', 'SCRIPT_GENERATING', 'IMAGE_GENERATING', 'TTS_GENERATING', 'CAPTION_ALIGNING', 'VISUAL_RENDERING', 'RENDERING', 'QC_RUNNING', 'QC_PASSED']
const WAITING = ['ASSET_READY', 'PREVIEW_PENDING', 'QC_FAILED']

/**
 * 仪表盘的任务统计——一律按**有效状态**（effStatus）汇总。
 *
 * 原实现按 generationTask.status 统计：「已完成」查 status='EXPORTED'，
 * 而生成任务的状态**永远不会**是 EXPORTED（那是 RenderTask 的状态，
 * 生成任务停在 VISUAL_RENDERING 不再前进）——已完成计数恒为 0、
 * 处理中虚高，仪表盘从上线起就是错的。
 */
export function summarizeGenTasks(tasks: HasRenderTasks[]): {
  exported: number
  previewPending: number
  failed: number
  funnel: { processing: number; waiting: number; done: number; failed: number }
} {
  let exported = 0
  let previewPending = 0
  let failed = 0
  let processing = 0
  let waiting = 0
  for (const t of tasks) {
    const s = effStatus(t)
    if (s === 'EXPORTED') exported++
    else if (s === 'FAILED') failed++
    if (s === 'PREVIEW_PENDING') previewPending++
    if (PROCESSING.includes(s)) processing++
    else if (WAITING.includes(s)) waiting++
  }
  return { exported, previewPending, failed, funnel: { processing, waiting, done: exported, failed } }
}
