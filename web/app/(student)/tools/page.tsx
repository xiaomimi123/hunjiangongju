'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'

type Tool = { id: string; name: string; description: string | null; priceCredits: number }

export default function ToolsPlazaPage() {
  const [tools, setTools] = useState<Tool[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ tools: Tool[] }>('/api/tools').then((d) => setTools(d.tools)).catch((e) => setErr((e as Error).message))
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">智能工具</h1>
        <p className="text-sm text-ink3">按次计费 · 失败自动退</p>
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="space-y-2.5">
        {tools.map((t) => (
          <Link key={t.id} href={`/tools/${t.id}`}
            className="card flex items-center gap-3 p-4 transition active:scale-[0.99]">
            <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-flame/[0.07] font-serif text-xl font-bold text-flame">
              {t.name.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.name}</p>
              {t.description && <p className="mt-0.5 truncate text-xs text-ink3">{t.description}</p>}
            </div>
            <span className="shrink-0 text-xs font-bold text-flame">{t.priceCredits} 积分/次</span>
          </Link>
        ))}
        {tools.length === 0 && !err && (
          <p className="card p-6 text-center text-sm text-ink3">暂无已上架的工具</p>
        )}
        <Link href="/tools/runs" className="card block p-3.5 text-center text-sm text-ink3">
          运行记录 →
        </Link>
      </div>
    </div>
  )
}
