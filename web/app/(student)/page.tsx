'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { StatusPill } from '@/components/ui'

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
    <div className="space-y-7">
      <h1 className="font-display text-[2rem] font-bold leading-tight tracking-tight">
        做一条<span className="grad-text">爆款</span>
      </h1>
      {err && <p className="pill pill-bad">{err}</p>}

      <section className="space-y-3">
        <p className="eyebrow">01 · 选文案包</p>
        <div className="space-y-2.5">
          {scripts.map((s) => {
            const on = selected === s.id
            return (
              <button key={s.id} onClick={() => setSelected(s.id)}
                className={`flex w-full items-center justify-between rounded-3xl border bg-surface p-4 text-left transition ${
                  on ? 'border-flame shadow-lift ring-4 ring-flame/10' : 'border-line shadow-card'
                }`}>
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="mt-0.5 text-xs text-ink3"><span className="num">{s._count.segments}</span> 个分镜段</p>
                </div>
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${on ? 'grad text-white' : 'border border-line text-transparent'}`}>✓</span>
              </button>
            )
          })}
          {scripts.length === 0 && <p className="card p-5 text-center text-sm text-ink3">暂无已发布的文案包</p>}
        </div>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">02 · 输出规格</p>
        <div className="flex gap-2.5">
          {(['9:16', '16:9'] as const).map((r) => {
            const on = ratio === r
            return (
              <button key={r} onClick={() => setRatio(r)}
                className={`flex flex-1 flex-col items-center gap-2 rounded-3xl border py-4 transition ${
                  on ? 'border-flame bg-surface shadow-lift ring-4 ring-flame/10' : 'border-line bg-surface shadow-card'
                }`}>
                <span className={`rounded-md ${on ? 'grad' : 'bg-ink3'} ${r === '9:16' ? 'h-8 w-[18px]' : 'h-[18px] w-8'}`} />
                <span className="text-sm font-medium">{r === '9:16' ? '竖屏' : '横屏'} <span className="num text-xs text-ink3">{r}</span></span>
              </button>
            )
          })}
        </div>
      </section>

      <button onClick={create} disabled={!selected || creating} className="btn-primary w-full text-base">
        {creating ? '生成中…' : '⚡ 一键生成'}
      </button>

      {recent.length > 0 && (
        <section className="space-y-3">
          <p className="eyebrow">最近作品</p>
          <div className="space-y-2.5">
            {recent.map((t) => (
              <Link key={t.id} href={`/works/${t.id}`}
                className="card flex items-center justify-between p-4">
                <span className="text-sm font-medium">{t.script?.title ?? '未知文案'}</span>
                <StatusPill status={t.status} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
