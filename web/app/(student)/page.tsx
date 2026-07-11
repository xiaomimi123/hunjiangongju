'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { StatusPill } from '@/components/ui'

type Task = { id: string; status: string; createdAt: string; script: { title: string } | null }
type Me = { nickname: string | null }

export default function HomePage() {
  const [recent, setRecent] = useState<Task[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api<Me>('/api/auth/me').then(setMe).catch(() => {})
    api<Task[]>('/api/tasks').then((t) => setRecent(t.slice(0, 4))).catch((e) => setErr((e as Error).message))
  }, [])

  return (
    <div className="space-y-7">
      <div>
        <p className="text-sm text-ink3">你好{me?.nickname ? `，${me.nickname}` : ''} 👋</p>
        <h1 className="mt-1 font-display text-[1.9rem] font-bold leading-tight tracking-tight">
          今天做一条<span className="grad-text">爆款</span>
        </h1>
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      <Link href="/templates" className="grad flex items-center justify-between rounded-3xl p-5 text-white shadow-lift">
        <div>
          <p className="text-lg font-bold">挑个模版，一键生成</p>
          <p className="mt-0.5 text-sm text-white/85">选文案包 → 出竖屏 / 横屏成片</p>
        </div>
        <span className="text-2xl">⚡</span>
      </Link>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow">最近作品</p>
          {recent.length > 0 && <Link href="/works" className="text-sm text-flame">全部</Link>}
        </div>
        {recent.length > 0 ? (
          <div className="space-y-2.5">
            {recent.map((t) => (
              <Link key={t.id} href={`/works/${t.id}`} className="card flex items-center justify-between p-4">
                <span className="min-w-0 truncate text-sm font-medium">{t.script?.title ?? '未知文案'}</span>
                <StatusPill status={t.status} />
              </Link>
            ))}
          </div>
        ) : (
          <Link href="/templates" className="card grid place-items-center gap-1 py-10 text-center">
            <span className="text-3xl">🎬</span>
            <p className="text-sm text-ink3">还没有作品，去挑个模版开始吧</p>
          </Link>
        )}
      </section>
    </div>
  )
}
