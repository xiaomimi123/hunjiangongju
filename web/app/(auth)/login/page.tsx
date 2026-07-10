'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'account' | 'key'>('account')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function login() {
    setErr(''); setLoading(true)
    try {
      const res = await api<{ role: string }>('/api/auth/login', {
        body: mode === 'key' ? { key } : { account, password },
      })
      router.replace(res.role === 'operator' ? '/admin/tasks' : '/')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-3">
        <span className="grad inline-flex h-11 w-11 items-center justify-center rounded-2xl text-xl shadow-lift">⚡</span>
        <h1 className="font-display text-[2rem] font-bold leading-none tracking-tight">
          投流<span className="grad-text">工作台</span>
        </h1>
        <p className="text-sm text-ink2">一键把素材混成投流爆款。</p>
      </div>

      <div className="flex gap-1 rounded-2xl bg-surface2 p-1 text-sm">
        {(['account', 'key'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 rounded-xl py-2.5 font-medium transition ${
              mode === m ? 'bg-surface text-ink shadow-card' : 'text-ink3'
            }`}>
            {m === 'account' ? '账号登录' : '密钥登录'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {mode === 'account' ? (
          <>
            <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="账号"
              className="field" autoCapitalize="none" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码"
              className="field" />
          </>
        ) : (
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="访问密钥"
            className="field" autoCapitalize="none" />
        )}
        {err && <p className="pill pill-bad">{err}</p>}
        <button onClick={login} disabled={loading} className="btn-primary w-full">
          {loading ? '登录中…' : '进入工作台'}
        </button>
      </div>
    </div>
  )
}
