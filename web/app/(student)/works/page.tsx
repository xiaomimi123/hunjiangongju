'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS, statusGroup } from '@/lib/status'

type Task = { id: string; status: string; createdAt: string; script: { title: string } | null }
const TABS = ['全部', '已完成', '处理中', '失败'] as const

export default function WorksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tab, setTab] = useState<(typeof TABS)[number]>('全部')

  useEffect(() => { api<Task[]>('/api/tasks').then(setTasks) }, [])
  const shown = tasks.filter((t) => tab === '全部' || statusGroup(t.status) === tab)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">我的作品</h1>
      <div className="flex gap-1 rounded-lg border bg-white p-1 text-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-2 ${tab === t ? 'bg-blue-600 text-white' : ''}`}>{t}</button>
        ))}
      </div>
      <ul className="space-y-2">
        {shown.map((t) => (
          <li key={t.id}>
            <Link href={`/works/${t.id}`} className="flex items-center justify-between rounded-xl border bg-white p-4">
              <div>
                <p className="font-medium">{t.script?.title ?? '未知文案'}</p>
                <p className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleString('zh-CN')}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs ${
                statusGroup(t.status) === '已完成' ? 'bg-green-100 text-green-700'
                : statusGroup(t.status) === '失败' ? 'bg-red-100 text-red-600'
                : 'bg-blue-100 text-blue-600'}`}>
                {STATUS_LABELS[t.status] ?? t.status}
              </span>
            </Link>
          </li>
        ))}
        {shown.length === 0 && <p className="py-8 text-center text-sm text-gray-400">暂无作品</p>}
      </ul>
    </div>
  )
}
