export const STATUS_LABELS: Record<string, string> = {
  CREATED: '已创建',
  SEGMENTING: '脚本分段中',
  MATCHING: '素材匹配中',
  MATERIAL_PENDING: '等待运营补充素材',
  STORYBOARD_READY: '分镜就绪',
  RENDERING: '视频渲染中',
  PREVIEW_PENDING: '待预览确认',
  REVISING: '修改中',
  QC_RUNNING: '质检中',
  QC_PASSED: '质检通过',
  QC_FAILED: '质检未通过',
  EXPORTED: '已完成',
  FAILED: '生成失败',
}

export function statusGroup(status: string): '已完成' | '失败' | '处理中' {
  if (status === 'EXPORTED') return '已完成'
  if (status === 'FAILED') return '失败'
  return '处理中'
}

export function isTerminal(status: string): boolean {
  return ['EXPORTED', 'FAILED', 'MATERIAL_PENDING', 'PREVIEW_PENDING', 'QC_FAILED'].includes(status)
}

// 状态胶囊色调：ok=已完成 bad=失败 warn=待人工 run=进行中
export function statusTone(status: string): 'ok' | 'bad' | 'warn' | 'run' {
  if (status === 'EXPORTED') return 'ok'
  if (status === 'FAILED') return 'bad'
  if (['MATERIAL_PENDING', 'PREVIEW_PENDING', 'QC_FAILED'].includes(status)) return 'warn'
  return 'run'
}

// signature：把 13 个状态收敛成 5 段"生产线"
export const PIPELINE = ['分段', '匹配', '渲染', '质检', '导出'] as const

const STAGE_OF: Record<string, number> = {
  CREATED: 0, SEGMENTING: 0,
  MATCHING: 1, MATERIAL_PENDING: 1,
  STORYBOARD_READY: 2, RENDERING: 2, PREVIEW_PENDING: 2, REVISING: 2,
  QC_RUNNING: 3, QC_FAILED: 3, QC_PASSED: 3,
  EXPORTED: 4,
}

export function stageIndex(status: string): number {
  return STAGE_OF[status] ?? 0
}
