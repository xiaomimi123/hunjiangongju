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

      {/* AI 实拍生图:置顶入口(渐变大卡),与普通扣子工具卡区分 */}
      <Link href="/photo"
        className="block rounded-[20px] bg-gradient-to-br from-[#FA5233] to-[#D11F1A] p-[18px] text-white shadow-lg shadow-flame/25 transition active:scale-[0.98]">
        <span className="flex items-center gap-3">
          <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-white/[0.18]">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h3l2-2.5h6L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
              <circle cx="12" cy="13.5" r="3.6" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-bold">AI 实拍生图</span>
            <span className="mt-0.5 block truncate text-xs text-white/85">拍下你的书，生成真实感种草照片</span>
          </span>
          <span className="shrink-0 text-[13px] font-medium">去拍照 →</span>
        </span>
        <span className="mt-2.5 flex gap-2">
          <span className="rounded-full bg-white/[0.16] px-2.5 py-1 text-[11px]">封面实拍</span>
          <span className="rounded-full bg-white/[0.16] px-2.5 py-1 text-[11px]">内页实拍</span>
        </span>
      </Link>

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
