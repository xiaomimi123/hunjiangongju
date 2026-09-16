'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'

type Run = {
  id: string; mode: string; count: number; status: string
  outputImages: { url: string }[] | null; creditsCost: number; createdAt: string
}

const STATUS_LABEL: Record<string, string> = { QUEUED: '排队中', RUNNING: '生成中', SUCCEEDED: '已完成', FAILED: '失败' }

export default function PhotoRunsPage() {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ runs: Run[] }>('/api/photo/runs').then((d) => setRuns(d.runs)).catch((e) => setErr((e as Error).message))
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">生图记录</h1>
        <p className="text-sm text-ink3">实拍生图的历史结果</p>
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="space-y-2.5">
        {(runs ?? []).map((r) => {
          const first = r.outputImages?.[0]?.url
          const tone = r.status === 'SUCCEEDED' ? 'text-ok' : r.status === 'FAILED' ? 'text-bad' : 'text-flame'
          return (
            <Link key={r.id} href={`/photo/runs/${r.id}`}
              className="card flex items-center gap-3 p-3.5 transition active:scale-[0.99]">
              {first ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${first}`} alt="" className="h-14 w-11 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="h-14 w-11 shrink-0 rounded-lg bg-surface2" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.mode === 'cover' ? '封面实拍' : '内页实拍'} · {r.count} 张</p>
                <p className="mt-0.5 text-xs text-ink3">{new Date(r.createdAt).toLocaleString()}</p>
              </div>
              <span className={`shrink-0 text-xs font-medium ${tone}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
            </Link>
          )
        })}
        {runs && runs.length === 0 && (
          <p className="card p-6 text-center text-sm text-ink3">还没有生图记录，去拍一张试试</p>
        )}
        {!runs && !err && <p className="py-10 text-center text-sm text-ink3">加载中…</p>}
      </div>
      <Link href="/photo" className="btn-primary w-full">去生成</Link>
    </div>
  )
}
