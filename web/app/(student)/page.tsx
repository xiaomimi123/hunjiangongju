'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS } from '@/lib/status'

type Script = { id: string; title: string; _count: { segments: number } }
type Task = { id: string; status: string; createdAt: string; script: { title: string } | null }

export default function HomePage() {
  const router = useRouter()
  const [scripts, setScripts] = useState<Script[]>([])
  const [recent, setRecent] = useState<Task[]>([])
  const [selected, setSelected] = useState('')
  const [ratio, setRatio] = useState<'9:16' | '16:9'>('9:16')
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api<Script[]>('/api/scripts').then(setScripts).catch((e) => setErr((e as Error).message))
    api<Task[]>('/api/tasks').then((t) => setRecent(t.slice(0, 3))).catch((e) => setErr((e as Error).message))
  }, [])

  async function create() {
    setErr(''); setCreating(true)
    try {
      const task = await api<{ id: string }>('/api/tasks', { body: { scriptId: selected, aspectRatio: ratio } })
      router.push(`/works/${task.id}`)
    } catch (e) {
      setErr((e as Error).message); setCreating(false)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">快速开始</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <section className="space-y-2">
        <h2 className="text-sm text-gray-500">1. 选择文案包</h2>
        {scripts.map((s) => (
          <button key={s.id} onClick={() => setSelected(s.id)}
            className={`block w-full rounded-xl border p-4 text-left ${selected === s.id ? 'border-blue-600 bg-blue-50' : 'bg-white'}`}>
            <p className="font-medium">{s.title}</p>
            <p className="text-xs text-gray-400">{s._count.segments} 个分镜段</p>
          </button>
        ))}
        {scripts.length === 0 && <p className="text-sm text-gray-400">暂无已发布的文案包</p>}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm text-gray-500">2. 选择输出规格</h2>
        <div className="flex gap-2">
          {(['9:16', '16:9'] as const).map((r) => (
            <button key={r} onClick={() => setRatio(r)}
              className={`flex-1 rounded-xl border py-3 ${ratio === r ? 'border-blue-600 bg-blue-50' : 'bg-white'}`}>
              {r === '9:16' ? '竖屏 9:16' : '横屏 16:9'}
            </button>
          ))}
        </div>
      </section>
      <button onClick={create} disabled={!selected || creating}
        className="w-full rounded-xl bg-blue-600 py-3 text-lg text-white disabled:opacity-40">
        {creating ? '创建中…' : '一键生成'}
      </button>
      <section className="space-y-2">
        <h2 className="text-sm text-gray-500">最近作品</h2>
        {recent.map((t) => (
          <Link key={t.id} href={`/works/${t.id}`}
            className="flex items-center justify-between rounded-xl border bg-white p-3">
            <span className="text-sm">{t.script?.title ?? '未知文案'}</span>
            <span className="text-xs text-gray-400">{STATUS_LABELS[t.status] ?? t.status}</span>
          </Link>
        ))}
      </section>
    </div>
  )
}
