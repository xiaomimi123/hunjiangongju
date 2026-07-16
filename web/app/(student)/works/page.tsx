'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'

// 生成流水线状态标签（本地维护，不用旧混剪的 lib/status.ts）
const GEN_LABELS: Record<string, string> = {
  GEN_CREATED: '已创建',
  SCRIPT_GENERATING: '文案生成中',
  IMAGE_GENERATING: '文生图中',
  TTS_GENERATING: '配音生成中',
  CAPTION_ALIGNING: '字幕对齐中',
  ASSET_READY: '素材就绪',
  VISUAL_RENDERING: '画面渲染中',
  RENDERING: '视频合成中',
  PREVIEW_PENDING: '待预览',
  QC_RUNNING: '质检中',
  QC_PASSED: '质检通过',
  QC_FAILED: '质检未通过',
  EXPORTED: '已完成',
  FAILED: '生成失败',
}

function group(status: string): '已完成' | '失败' | '生成中' {
  if (status === 'EXPORTED') return '已完成'
  if (status === 'FAILED' || status === 'QC_FAILED') return '失败'
  return '生成中'
}

function Pill({ status }: { status: string }) {
  const g = group(status)
  const tone = g === '已完成' ? 'ok' : g === '失败' ? 'bad' : 'run'
  return <span className={`pill pill-${tone}`}>{GEN_LABELS[status] ?? status}</span>
}

type Task = {
  id: string; subject: string; status: string; createdAt: string
  framework: { name: string | null } | null
  renderTasks: { status: string }[]
}
// autoRender 任务 generationTask.status 停在 VISUAL_RENDERING；真实终态在最新 RenderTask 上
function effStatus(t: Task): string { return t.renderTasks[0]?.status ?? t.status }
const TABS = ['全部', '生成中', '已完成', '失败'] as const

export default function WorksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tab, setTab] = useState<(typeof TABS)[number]>('全部')
  const [err, setErr] = useState('')

  useEffect(() => { api<Task[]>('/api/generate').then(setTasks).catch((e) => setErr((e as Error).message)) }, [])
  const shown = tasks.filter((t) => tab === '全部' || group(effStatus(t)) === tab)

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">我的作品</h1>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto rounded-2xl bg-surface2 p-1 text-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 whitespace-nowrap rounded-xl py-2.5 font-medium transition ${
              tab === t ? 'bg-surface text-ink shadow-card' : 'text-ink3'
            }`}>{t}</button>
        ))}
      </div>

      <ul className="space-y-2.5">
        {shown.map((t) => (
          <li key={t.id}>
            <Link href={`/works/${t.id}`} className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.subject}</p>
                <p className="mt-0.5 truncate text-xs text-ink3">
                  {t.framework?.name ? `${t.framework.name} · ` : ''}
                  <span className="num">{new Date(t.createdAt).toLocaleString('zh-CN')}</span>
                </p>
              </div>
              <Pill status={effStatus(t)} />
            </Link>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="card grid place-items-center gap-1 py-14 text-center">
            <span className="text-3xl">🎬</span>
            <p className="text-sm text-ink3">还没有作品，去框架库挑一个生成吧</p>
          </li>
        )}
      </ul>
    </div>
  )
}
