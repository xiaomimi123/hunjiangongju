// 生成流水线状态标签（本地维护，不动共享 lib/status.ts —— 其只认旧混剪状态）
export const GEN_LABELS: Record<string, string> = {
  GEN_CREATED: '已创建',
  SCRIPT_GENERATING: '文案生成中',
  IMAGE_GENERATING: '文生图中',
  TTS_GENERATING: '配音生成中',
  CAPTION_ALIGNING: '字幕对齐中',
  ASSET_READY: '素材就绪',
  VISUAL_RENDERING: '画面渲染中',
  RENDERING: '视频合成中',
  PREVIEW_PENDING: '待预览确认',
  QC_RUNNING: '质检中',
  QC_PASSED: '质检通过',
  QC_FAILED: '质检未通过',
  EXPORTED: '已完成',
  FAILED: '生成失败',
}

// 终态（停止轮询）：包含需人工介入的 ASSET_READY / PREVIEW_PENDING / QC_FAILED
export function genIsTerminal(status: string): boolean {
  return ['EXPORTED', 'FAILED', 'PREVIEW_PENDING', 'ASSET_READY', 'QC_FAILED'].includes(status)
}

function genTone(status: string): 'ok' | 'bad' | 'warn' | 'run' {
  if (status === 'EXPORTED' || status === 'QC_PASSED') return 'ok'
  if (status === 'FAILED' || status === 'QC_FAILED') return 'bad'
  if (['ASSET_READY', 'PREVIEW_PENDING'].includes(status)) return 'warn'
  return 'run'
}

export function GenPill({ status }: { status: string }) {
  return <span className={`pill pill-${genTone(status)}`}>{GEN_LABELS[status] ?? status}</span>
}
