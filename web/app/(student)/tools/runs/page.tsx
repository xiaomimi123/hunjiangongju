'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'

type Status = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
type Run = { id: string; toolId: string; status: Status; errorMsg: string | null; creditsCost: number; createdAt: string; finishedAt: string | null }
type Tool = { id: string; name: string }

const STATUS_LABEL: Record<Status, string> = {
  QUEUED: '排队中', RUNNING: '运行中', SUCCEEDED: '成功', FAILED: '失败',
}
// 状态点：SUCCEEDED 绿 / QUEUED+RUNNING 品牌红加脉冲 / FAILED 深红——照样稿 .runrow .st
const DOT_TONE: Record<Status, string> = {
  SUCCEEDED: 'bg-ok',
  QUEUED: 'bg-flame animate-pulse ring-4 ring-flame/15',
  RUNNING: 'bg-flame animate-pulse ring-4 ring-flame/15',
  FAILED: 'bg-bad',
}
const STATUS_TEXT_TONE: Record<Status, string> = {
  SUCCEEDED: 'text-ok', QUEUED: 'text-flame', RUNNING: 'text-flame', FAILED: 'text-bad',
}

export default function ToolRunsPage() {
  const [runs, setRuns] = useState<Run[]>([])
  const [tools, setTools] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ runs: Run[] }>('/api/tools/runs').then((d) => setRuns(d.runs)).catch((e) => setErr((e as Error).message))
    // 工具名对照：拉当前 enabled 列表，下架工具查不到，页面上显示「已下架工具」
    api<{ tools: Tool[] }>('/api/tools').then((d) => {
      const map: Record<string, string> = {}
      for (const t of d.tools) map[t.id] = t.name
      setTools(map)
    }).catch(() => {})
  }, [])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">运行记录</h1>
        <Link href="/tools" className="text-sm text-flame">工具广场</Link>
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="space-y-2.5">
        {runs.map((r) => (
          <Link key={r.id} href={`/tools/runs/${r.id}`}
            className="card flex items-center gap-3 p-4 transition active:scale-[0.99]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_TONE[r.status]}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{tools[r.toolId] ?? '已下架工具'}</p>
              <p className="mt-0.5 truncate text-xs text-ink3">
                {r.status === 'FAILED' && r.creditsCost > 0 ? `已退 ${r.creditsCost} 积分` : new Date(r.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="shrink-0 text-right text-xs">
              <p className={`font-semibold ${STATUS_TEXT_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</p>
              <p className="mt-0.5 text-ink3">{new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </Link>
        ))}
        {runs.length === 0 && !err && (
          <p className="card p-6 text-center text-sm text-ink3">还没有运行记录</p>
        )}
      </div>
    </div>
  )
}
