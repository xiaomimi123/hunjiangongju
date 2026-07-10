'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { statusGroup } from '@/lib/status'
import { StatusPill } from '@/components/ui'

type Task = { id: string; status: string; createdAt: string; script: { title: string } | null }
const TABS = ['全部', '已完成', '处理中', '失败'] as const

export default function WorksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tab, setTab] = useState<(typeof TABS)[number]>('全部')
  const [err, setErr] = useState('')

  useEffect(() => { api<Task[]>('/api/tasks').then(setTasks).catch((e) => setErr((e as Error).message)) }, [])
  const shown = tasks.filter((t) => tab === '全部' || statusGroup(t.status) === tab)

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
            <Link href={`/works/${t.id}`} className="card flex items-center justify-between p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.script?.title ?? '未知文案'}</p>
                <p className="num mt-0.5 text-xs text-ink3">{new Date(t.createdAt).toLocaleString('zh-CN')}</p>
              </div>
              <StatusPill status={t.status} />
            </Link>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="card grid place-items-center gap-1 py-14 text-center">
            <span className="text-3xl">🎬</span>
            <p className="text-sm text-ink3">还没有作品，去首页生成一条吧</p>
          </li>
        )}
      </ul>
    </div>
  )
}
