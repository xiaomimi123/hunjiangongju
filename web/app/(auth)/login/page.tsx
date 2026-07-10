'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'

type Tab = 'login' | 'register'

export default function LoginPage() {
  const router = useRouter()
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'form' | 'verify' | 'forgot' | 'reset'>('form')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<{ emailEnabled: boolean }>('/api/auth/config').then((c) => setEmailEnabled(c.emailEnabled)).catch(() => {}) }, [])

  function reset() { setErr(''); setMsg('') }
  function go(role: string) { router.replace(role === 'operator' ? '/admin/students' : '/') }

  async function login() {
    reset(); setBusy(true)
    try { const r = await api<{ role: string }>('/api/auth/login', { body: { email, password } }); go(r.role) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function register() {
    reset(); setBusy(true)
    try {
      const r = await api<{ role?: string; needsVerification: boolean }>('/api/auth/register', { body: { email, password, nickname } })
      if (r.needsVerification) { setStage('verify'); setMsg('验证码已发送至邮箱') } else go(r.role!)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function verify() {
    reset(); setBusy(true)
    try { const r = await api<{ role: string }>('/api/auth/verify-email', { body: { email, password, nickname, code } }); go(r.role) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function forgot() {
    reset(); setBusy(true)
    try { await api('/api/auth/forgot', { body: { email } }); setStage('reset'); setMsg('若邮箱已注册，验证码已发送') }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function doReset() {
    reset(); setBusy(true)
    try { await api('/api/auth/reset', { body: { email, code, newPassword: password } }); setMsg('密码已重置，请登录'); setStage('form'); setTab('login'); setPassword(''); setCode('') }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-3">
        <span className="grad inline-flex h-11 w-11 items-center justify-center rounded-2xl text-xl shadow-lift">⚡</span>
        <h1 className="font-display text-[2rem] font-bold leading-none tracking-tight">投流<span className="grad-text">工作台</span></h1>
        <p className="text-sm text-ink2">一键把素材混成投流爆款。</p>
      </div>

      {stage === 'form' && (
        <>
          <div className="flex gap-1 rounded-2xl bg-surface2 p-1 text-sm">
            {(['login', 'register'] as Tab[]).map((t) => (
              <button key={t} onClick={() => { setTab(t); reset() }}
                className={`flex-1 rounded-xl py-2.5 font-medium transition ${tab === t ? 'bg-surface text-ink shadow-card' : 'text-ink3'}`}>
                {t === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" autoCapitalize="none" />
            {tab === 'register' && <input className="field" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="昵称" />}
            <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
            {err && <p className="pill pill-bad">{err}</p>}
            {msg && <p className="pill pill-ok">{msg}</p>}
            <button onClick={tab === 'login' ? login : register} disabled={busy} className="btn-primary w-full">
              {busy ? '处理中…' : tab === 'login' ? '进入工作台' : '注册'}
            </button>
            {tab === 'login' && emailEnabled && (
              <button onClick={() => { setStage('forgot'); reset() }} className="w-full text-center text-sm text-ink3">忘记密码？</button>
            )}
          </div>
        </>
      )}

      {stage === 'verify' && (
        <div className="space-y-3">
          <p className="text-sm text-ink2">验证码已发送至 <b>{email}</b></p>
          <input className="field num tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" />
          {err && <p className="pill pill-bad">{err}</p>}
          {msg && <p className="pill pill-ok">{msg}</p>}
          <button onClick={verify} disabled={busy} className="btn-primary w-full">完成注册</button>
          <button onClick={() => { setStage('form'); reset() }} className="w-full text-center text-sm text-ink3">返回</button>
        </div>
      )}

      {stage === 'forgot' && (
        <div className="space-y-3">
          <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="注册邮箱" autoCapitalize="none" />
          {err && <p className="pill pill-bad">{err}</p>}
          <button onClick={forgot} disabled={busy} className="btn-primary w-full">发送重置验证码</button>
          <button onClick={() => { setStage('form'); reset() }} className="w-full text-center text-sm text-ink3">返回登录</button>
        </div>
      )}

      {stage === 'reset' && (
        <div className="space-y-3">
          <input className="field num tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" />
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="新密码" />
          {err && <p className="pill pill-bad">{err}</p>}
          {msg && <p className="pill pill-ok">{msg}</p>}
          <button onClick={doReset} disabled={busy} className="btn-primary w-full">重置密码</button>
          <button onClick={() => { setStage('form'); reset() }} className="w-full text-center text-sm text-ink3">返回登录</button>
        </div>
      )}
    </div>
  )
}
