'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'

type Me = { email: string; nickname: string | null; role: string }

export default function MePage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => { api<Me>('/api/auth/me').then(setMe).catch((e) => setErr((e as Error).message)) }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  const initial = (me?.nickname ?? me?.email ?? '?').slice(0, 1).toUpperCase()

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">我的</h1>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card flex items-center gap-4 p-5">
        <span className="grad grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-xl font-bold text-white shadow-lift">{initial}</span>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{me?.nickname ?? '学员'}</p>
          <p className="mt-0.5 truncate text-sm text-ink3">{me?.email ?? '—'}</p>
        </div>
      </div>

      <div className="card divide-y divide-line">
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-sm text-ink2">账号</span>
          <span className="truncate pl-4 text-sm">{me?.email ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-sm text-ink2">身份</span>
          <span className="chip"><span className="chip-dot grad" />学员</span>
        </div>
      </div>

      <button onClick={logout} className="btn-danger w-full">退出登录</button>
    </div>
  )
}
