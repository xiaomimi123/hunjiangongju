'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'
import BottomSheet from '@/components/BottomSheet'

type Me = { email: string; nickname: string | null; role: string }

export default function MePage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [err, setErr] = useState('')

  // 修改密码弹层
  const [pwOpen, setPwOpen] = useState(false)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<Me>('/api/auth/me').then(setMe).catch((e) => setErr((e as Error).message)) }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  function openPw() { setCur(''); setNext(''); setNext2(''); setPwErr(''); setPwMsg(''); setPwOpen(true) }

  async function changePw() {
    setPwErr(''); setPwMsg('')
    if (next !== next2) { setPwErr('两次输入的新密码不一致'); return }
    setBusy(true)
    try {
      await api('/api/auth/change-password', { body: { currentPassword: cur, newPassword: next } })
      setPwMsg('密码已更新'); setTimeout(() => setPwOpen(false), 900)
    } catch (e) { setPwErr((e as Error).message) } finally { setBusy(false) }
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
        <button onClick={openPw} className="flex w-full items-center justify-between px-4 py-3.5 text-left transition active:bg-surface2">
          <span className="text-sm text-ink2">修改密码</span>
          <span className="text-ink3">›</span>
        </button>
      </div>

      <button onClick={logout} className="btn-danger w-full">退出登录</button>

      <BottomSheet open={pwOpen} onClose={() => { if (!busy) setPwOpen(false) }} title="修改密码">
        <div className="space-y-3">
          <input className="field" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="当前密码" />
          <input className="field" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="新密码（至少 8 位）" />
          <input className="field" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} placeholder="确认新密码" />
          {pwErr && <p className="pill pill-bad">{pwErr}</p>}
          {pwMsg && <p className="pill pill-ok">{pwMsg}</p>}
          <button onClick={changePw} disabled={busy} className="btn-primary w-full">{busy ? '处理中…' : '确认修改'}</button>
        </div>
      </BottomSheet>
    </div>
  )
}
