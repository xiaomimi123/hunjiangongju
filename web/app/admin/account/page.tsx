'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'

type Me = { email: string; nickname: string | null; role: string }

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<Me>('/api/auth/me').then(setMe).catch((e) => setErr((e as Error).message)) }, [])

  async function change() {
    setErr(''); setMsg('')
    if (next !== next2) { setErr('两次输入的新密码不一致'); return }
    setBusy(true)
    try {
      await api('/api/auth/change-password', { body: { currentPassword: cur, newPassword: next } })
      setMsg('密码已更新'); setCur(''); setNext(''); setNext2('')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="font-display text-2xl font-bold">账号</h1>

      <div className="card divide-y divide-line">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-sm text-ink2">登录账号</span>
          <span className="text-sm font-medium">{me?.email ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-sm text-ink2">身份</span>
          <span className="chip"><span className="chip-dot bg-warn" />运营</span>
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <p className="eyebrow">修改密码</p>
        <input className="field" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="当前密码" autoComplete="current-password" />
        <input className="field" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="新密码（至少 8 位）" autoComplete="new-password" />
        <input className="field" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} placeholder="确认新密码" autoComplete="new-password" />
        {err && <p className="pill pill-bad">{err}</p>}
        {msg && <p className="pill pill-ok">{msg}</p>}
        <button onClick={change} disabled={busy} className="btn-primary">{busy ? '处理中…' : '确认修改'}</button>
      </div>
    </div>
  )
}
