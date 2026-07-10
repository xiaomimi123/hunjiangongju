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
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-center text-xl font-bold">投流素材混剪工具</h1>
      <div className="flex rounded-lg border p-1 text-sm">
        <button onClick={() => setMode('account')}
          className={`flex-1 rounded-md py-2 ${mode === 'account' ? 'bg-blue-600 text-white' : ''}`}>账号登录</button>
        <button onClick={() => setMode('key')}
          className={`flex-1 rounded-md py-2 ${mode === 'key' ? 'bg-blue-600 text-white' : ''}`}>密钥登录</button>
      </div>
      {mode === 'account' ? (
        <>
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="账号"
            className="rounded-lg border px-3 py-3" autoCapitalize="none" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码"
            className="rounded-lg border px-3 py-3" />
        </>
      ) : (
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="访问密钥"
          className="rounded-lg border px-3 py-3" autoCapitalize="none" />
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button onClick={login} disabled={loading}
        className="rounded-lg bg-blue-600 py-3 text-white disabled:opacity-50">
        {loading ? '登录中…' : '登录'}
      </button>
    </div>
  )
}
