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
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">任务队列</h1>
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

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">文案标题</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="max-w-xs truncate px-4 py-3 font-medium">{t.script?.title ?? '未知文案'}</td>
                <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                <td className="num px-4 py-3 text-ink3">{new Date(t.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/tasks/${t.id}`} className="btn-quiet px-2 text-sm">查看</Link>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-ink3">暂无任务</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
