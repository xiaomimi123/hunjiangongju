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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">工具广场</h1>
          <p className="text-sm text-ink3">扣子工作流小工具，按需消耗积分</p>
        </div>
        <Link href="/tools/runs" className="card shrink-0 px-3.5 py-2 text-sm text-ink2">我的记录</Link>
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="space-y-2.5">
        {tools.map((t) => (
          <Link key={t.id} href={`/tools/${t.id}`}
            className="card flex w-full items-center justify-between gap-3 p-4 text-left transition active:scale-[0.99]">
            <div className="min-w-0">
              <p className="truncate font-medium">{t.name}</p>
              {t.description && <p className="mt-0.5 truncate text-xs text-ink3">{t.description}</p>}
            </div>
            <span className="grad shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">
              {t.priceCredits} 积分
            </span>
          </Link>
        ))}
        {tools.length === 0 && !err && (
          <p className="card p-6 text-center text-sm text-ink3">暂无已上架的工具</p>
        )}
      </div>
    </div>
  )
}
