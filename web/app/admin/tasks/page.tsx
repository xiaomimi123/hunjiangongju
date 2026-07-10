'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS } from '@/lib/status'

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
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">任务队列</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm ${filter === f ? 'border-blue-600 bg-blue-50 text-blue-600' : 'bg-white'}`}>
            {f === '' ? '全部' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link href={`/admin/tasks/${t.id}`} className="flex items-center justify-between rounded-xl border bg-white p-3">
              <div>
                <p className="text-sm font-medium">{t.script?.title ?? '未知文案'}</p>
                <p className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleString('zh-CN')}</p>
              </div>
              <span className="text-xs text-blue-600">{STATUS_LABELS[t.status] ?? t.status}</span>
            </Link>
          </li>
        ))}
        {tasks.length === 0 && <p className="py-8 text-center text-sm text-gray-400">暂无任务</p>}
      </ul>
    </div>
  )
}
