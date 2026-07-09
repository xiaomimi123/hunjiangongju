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
