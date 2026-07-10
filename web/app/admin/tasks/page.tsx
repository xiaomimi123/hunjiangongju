'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS } from '@/lib/status'
import { StatusPill } from '@/components/ui'

type Task = { id: string; status: string; createdAt: string; script: { title: string } | null }
const FILTERS = ['', 'MATERIAL_PENDING', 'PREVIEW_PENDING', 'QC_FAILED', 'FAILED', 'EXPORTED']

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { setTasks(await api<Task[]>(`/api/tasks${filter ? `?status=${filter}` : ''}`)) }
    catch (e) { setErr((e as Error).message) }
  }, [filter])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">任务队列</h1>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="flex gap-1 overflow-x-auto no-scrollbar rounded-full bg-surface2 p-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition ${
              filter === f ? 'bg-surface text-ink shadow-card' : 'text-ink3'
            }`}>
            {f === '' ? '全部' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      <ul className="space-y-2.5">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link href={`/admin/tasks/${t.id}`} className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.script?.title ?? '未知文案'}</p>
                <p className="num mt-0.5 text-xs text-ink3">{new Date(t.createdAt).toLocaleString('zh-CN')}</p>
              </div>
              <StatusPill status={t.status} />
            </Link>
          </li>
        ))}
        {tasks.length === 0 && <p className="card p-8 text-center text-sm text-ink3">暂无任务</p>}
      </ul>
    </div>
  )
}
