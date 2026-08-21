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
