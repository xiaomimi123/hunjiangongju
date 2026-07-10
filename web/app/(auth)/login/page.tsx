'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'

type View = 'login' | 'register' | 'reset'

function Eye({ off }: { off: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {off ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 4.2A9.6 9.6 0 0 1 12 4c6 0 10 8 10 8a17.7 17.7 0 0 1-2.4 3.4M6.1 6.1A17.6 17.6 0 0 0 2 12s4 8 10 8a9.6 9.6 0 0 0 3.9-.8" />
        </>
      ) : (
        <>
          <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}

function PwField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input className="field pr-12" type={show ? 'text' : 'password'} value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <button type="button" onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 active:text-ink"
        aria-label={show ? '隐藏密码' : '显示密码'}>
        <Eye off={show} />
      </button>
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [view, setView] = useState<View>('login')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [cd, setCd] = useState(0)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<{ emailEnabled: boolean }>('/api/auth/config').then((c) => setEmailEnabled(c.emailEnabled)).catch(() => {}) }, [])
  useEffect(() => { if (cd <= 0) return; const t = setTimeout(() => setCd(cd - 1), 1000); return () => clearTimeout(t) }, [cd])

  function clear() { setErr(''); setMsg('') }
  function switchTo(v: View) { setView(v); clear(); setCode(''); setPassword(''); setPassword2('') }
  function go(role: string) { router.replace(role === 'operator' ? '/admin/students' : '/') }

  async function getCode(kind: 'register' | 'reset') {
    clear()
    try {
      await api(kind === 'register' ? '/api/auth/send-code' : '/api/auth/forgot', { body: { email } })
      setCd(60)
      setMsg(kind === 'register' ? '验证码已发送至邮箱' : '若邮箱已注册，验证码已发送')
    } catch (e) { setErr((e as Error).message) }
  }

  async function login() {
    clear(); setBusy(true)
    try { const r = await api<{ role: string }>('/api/auth/login', { body: { email, password } }); go(r.role) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function register() {
    clear()
    if (password !== password2) { setErr('两次输入的密码不一致'); return }
    setBusy(true)
    try {
      if (emailEnabled) {
        const r = await api<{ role: string }>('/api/auth/verify-email', { body: { email, code, password, nickname } })
        go(r.role)
      } else {
        const r = await api<{ role: string }>('/api/auth/register', { body: { email, password, nickname } })
        go(r.role)
      }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function doReset() {
    clear()
    if (password !== password2) { setErr('两次输入的密码不一致'); return }
    setBusy(true)
    try {
      await api('/api/auth/reset', { body: { email, code, newPassword: password } })
      setMsg('密码已重置，请登录'); switchTo('login')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const CodeRow = ({ kind }: { kind: 'register' | 'reset' }) => (
    <div className="flex gap-2">
      <input className="field num flex-1 tracking-widest" value={code} onChange={(e) => setCode(e.target.value)}
        placeholder="6 位验证码" inputMode="numeric" maxLength={6} />
      <button type="button" onClick={() => getCode(kind)} disabled={cd > 0 || !email}
        className="btn-ghost shrink-0 whitespace-nowrap px-4 text-sm disabled:opacity-40">
        {cd > 0 ? `${cd}s` : '获取验证码'}
      </button>
    </div>
  )

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-3">
        <span className="grad inline-flex h-11 w-11 items-center justify-center rounded-2xl text-xl shadow-lift">⚡</span>
        <h1 className="font-display text-[2rem] font-bold leading-none tracking-tight">投流<span className="grad-text">工作台</span></h1>
        <p className="text-sm text-ink2">一键把素材混成投流爆款。</p>
      </div>

      {view !== 'reset' && (
        <div className="flex gap-1 rounded-2xl bg-surface2 p-1 text-sm">
          {(['login', 'register'] as View[]).map((v) => (
            <button key={v} onClick={() => switchTo(v)}
              className={`flex-1 rounded-xl py-2.5 font-medium transition ${view === v ? 'bg-surface text-ink shadow-card' : 'text-ink3'}`}>
              {v === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>
      )}

      {view === 'login' && (
        <div className="space-y-3">
          <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" autoCapitalize="none" />
          <PwField value={password} onChange={setPassword} placeholder="密码" />
          {err && <p className="pill pill-bad">{err}</p>}
          {msg && <p className="pill pill-ok">{msg}</p>}
          <button onClick={login} disabled={busy} className="btn-primary w-full">{busy ? '处理中…' : '进入工作台'}</button>
          {emailEnabled && (
            <button onClick={() => switchTo('reset')} className="w-full text-center text-sm text-ink3">忘记密码？</button>
          )}
        </div>
      )}

      {view === 'register' && (
        <div className="space-y-3">
          <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" autoCapitalize="none" />
          {emailEnabled && <CodeRow kind="register" />}
          <input className="field" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="昵称" />
          <PwField value={password} onChange={setPassword} placeholder="密码（至少 6 位）" />
          <PwField value={password2} onChange={setPassword2} placeholder="确认密码" />
          {err && <p className="pill pill-bad">{err}</p>}
          {msg && <p className="pill pill-ok">{msg}</p>}
          <button onClick={register} disabled={busy} className="btn-primary w-full">{busy ? '处理中…' : '注册'}</button>
        </div>
      )}

      {view === 'reset' && (
        <div className="space-y-3">
          <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="注册邮箱" autoCapitalize="none" />
          <CodeRow kind="reset" />
          <PwField value={password} onChange={setPassword} placeholder="新密码（至少 6 位）" />
          <PwField value={password2} onChange={setPassword2} placeholder="确认新密码" />
          {err && <p className="pill pill-bad">{err}</p>}
          {msg && <p className="pill pill-ok">{msg}</p>}
          <button onClick={doReset} disabled={busy} className="btn-primary w-full">{busy ? '处理中…' : '重置密码'}</button>
          <button onClick={() => switchTo('login')} className="w-full text-center text-sm text-ink3">返回登录</button>
        </div>
      )}
    </div>
  )
}
