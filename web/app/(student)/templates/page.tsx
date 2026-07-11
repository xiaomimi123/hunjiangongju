'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'
import BottomSheet from '@/components/BottomSheet'

type Script = { id: string; title: string; _count: { segments: number } }

export default function TemplatesPage() {
  const router = useRouter()
  const [scripts, setScripts] = useState<Script[]>([])
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState<Script | null>(null)
  const [ratio, setRatio] = useState<'9:16' | '16:9'>('9:16')
  const [creating, setCreating] = useState(false)

  useEffect(() => { api<Script[]>('/api/scripts').then(setScripts).catch((e) => setErr((e as Error).message)) }, [])

  async function create() {
    if (!picked) return
    setErr(''); setCreating(true)
    try {
      const task = await api<{ id: string }>('/api/tasks', { body: { scriptId: picked.id, aspectRatio: ratio } })
      router.push(`/works/${task.id}`)
    } catch (e) { setErr((e as Error).message); setCreating(false) }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">模版库</h1>
      <p className="text-sm text-ink3">选一个文案包，一键生成带货短视频</p>
      {err && !picked && <p className="pill pill-bad">{err}</p>}

      <div className="space-y-2.5">
        {scripts.map((s) => (
          <button key={s.id} onClick={() => { setErr(''); setRatio('9:16'); setPicked(s) }}
            className="card flex w-full items-center justify-between p-4 text-left transition active:scale-[0.99]">
            <div className="min-w-0">
              <p className="truncate font-medium">{s.title}</p>
              <p className="mt-0.5 text-xs text-ink3"><span className="num">{s._count.segments}</span> 个分镜段</p>
            </div>
            <span className="grad shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">用它生成</span>
          </button>
        ))}
        {scripts.length === 0 && <p className="card p-6 text-center text-sm text-ink3">暂无已发布的模版</p>}
      </div>

      <BottomSheet open={!!picked} onClose={() => { if (!creating) setPicked(null) }} title={picked?.title ?? ''}>
        <div className="space-y-4">
          <div>
            <p className="eyebrow mb-2">输出规格</p>
            <div className="flex gap-2.5">
              {(['9:16', '16:9'] as const).map((r) => {
                const on = ratio === r
                return (
                  <button key={r} onClick={() => setRatio(r)}
                    className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border py-4 transition ${
                      on ? 'border-flame bg-surface shadow-lift ring-4 ring-flame/10' : 'border-line bg-surface'
                    }`}>
                    <span className={`rounded-md ${on ? 'grad' : 'bg-ink3'} ${r === '9:16' ? 'h-8 w-[18px]' : 'h-[18px] w-8'}`} />
                    <span className="text-sm font-medium">{r === '9:16' ? '竖屏' : '横屏'} <span className="num text-xs text-ink3">{r}</span></span>
                  </button>
                )
              })}
            </div>
          </div>
          {err && <p className="pill pill-bad">{err}</p>}
          <button onClick={create} disabled={creating} className="btn-primary w-full">{creating ? '生成中…' : '⚡ 一键生成'}</button>
        </div>
      </BottomSheet>
    </div>
  )
}
