// 拆解流水线状态标签（本地维护，不动共享 lib/status.ts —— 其只认旧混剪状态）
export const EXTRACT_LABELS: Record<string, string> = {
  CREATED: '已创建',
  DOWNLOADING: '下载中',
  TRANSCRIBING: '转写中',
  SCENE_DETECTING: '场景检测中',
  FRAMEWORK_EXTRACTING: '框架提炼中',
  FRAMEWORK_READY: '框架就绪',
  FAILED: '拆解失败',
}

// 拆解流程顺序（用于进度展示）
export const EXTRACT_FLOW = [
  'CREATED',
  'DOWNLOADING',
  'TRANSCRIBING',
  'SCENE_DETECTING',
  'FRAMEWORK_EXTRACTING',
  'FRAMEWORK_READY',
]

// 终态（停止轮询）
export function extractIsTerminal(status: string): boolean {
  return status === 'FRAMEWORK_READY' || status === 'FAILED'
}

function extractTone(status: string): 'ok' | 'bad' | 'run' {
  if (status === 'FRAMEWORK_READY') return 'ok'
  if (status === 'FAILED') return 'bad'
  return 'run'
}

export function ExtractPill({ status }: { status: string }) {
  return <span className={`pill pill-${extractTone(status)}`}>{EXTRACT_LABELS[status] ?? status}</span>
}
