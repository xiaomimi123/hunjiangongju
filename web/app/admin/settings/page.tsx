'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'

type Cfg = { host: string; port: number; secure: boolean; username: string; fromAddress: string; fromName: string; enabled: boolean; hasPassword: boolean }

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [password, setPassword] = useState('')
  const [testTo, setTestTo] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<Cfg>('/api/admin/smtp').then(setCfg).catch((e) => setErr((e as Error).message)) }, [])

  function up<K extends keyof Cfg>(k: K, v: Cfg[K]) { setCfg((c) => (c ? { ...c, [k]: v } : c)) }

  async function save() {
    if (!cfg) return
    setBusy(true); setErr(''); setMsg('')
    try {
      await api('/api/admin/smtp', { method: 'PUT', body: { ...cfg, password: password || undefined } })
      setMsg('已保存'); setPassword('')
      setCfg(await api<Cfg>('/api/admin/smtp'))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function test() {
    if (!cfg) return
    setBusy(true); setErr(''); setMsg('')
    try {
      await api('/api/admin/smtp/test', { method: 'POST', body: { ...cfg, password: password || undefined, to: testTo } })
      setMsg('测试邮件已发送')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!cfg && err) return <p className="pill pill-bad">{err}</p>
  if (!cfg) return <p className="text-ink3">加载中…</p>

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="font-display text-2xl font-bold">邮件服务（SMTP）</h1>
      {err && <p className="pill pill-bad">{err}</p>}
      {msg && <p className="pill pill-ok">{msg}</p>}

      <div className="card space-y-4 p-5">
        <label className="flex items-center justify-between">
          <span className="font-medium">启用邮件服务</span>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => up('enabled', e.target.checked)} className="h-5 w-5" />
        </label>
        <p className="text-xs text-ink3">关闭时：注册直接可用、忘记密码不可用。开启时：注册需邮箱验证码、支持忘记密码。</p>
      </div>

      <div className="card grid gap-3 p-5">
        <label className="text-sm text-ink2">SMTP 主机
          <input className="field mt-1" value={cfg.host} onChange={(e) => up('host', e.target.value)} placeholder="smtp.example.com" /></label>
        <div className="flex gap-3">
          <label className="flex-1 text-sm text-ink2">端口
            <input className="field mt-1" type="number" value={cfg.port} onChange={(e) => up('port', Number(e.target.value))} /></label>
          <label className="flex-1 text-sm text-ink2">加密
            <select className="field mt-1" value={cfg.secure ? 'ssl' : 'starttls'} onChange={(e) => up('secure', e.target.value === 'ssl')}>
              <option value="ssl">SSL (465)</option>
              <option value="starttls">STARTTLS (587)</option>
            </select></label>
        </div>
        <label className="text-sm text-ink2">账号
          <input className="field mt-1" value={cfg.username} onChange={(e) => up('username', e.target.value)} autoCapitalize="none" /></label>
        <label className="text-sm text-ink2">密码 {cfg.hasPassword && <span className="text-ink3">（已设置，留空则不改）</span>}
          <input className="field mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={cfg.hasPassword ? '••••••••' : ''} /></label>
        <div className="flex gap-3">
          <label className="flex-1 text-sm text-ink2">发件邮箱
            <input className="field mt-1" value={cfg.fromAddress} onChange={(e) => up('fromAddress', e.target.value)} autoCapitalize="none" /></label>
          <label className="flex-1 text-sm text-ink2">发件人名
            <input className="field mt-1" value={cfg.fromName} onChange={(e) => up('fromName', e.target.value)} /></label>
        </div>
        <button onClick={save} disabled={busy} className="btn-primary">保存配置</button>
      </div>

      <div className="card space-y-3 p-5">
        <p className="eyebrow">发送测试邮件</p>
        <div className="flex gap-3">
          <input className="field" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="收件邮箱" autoCapitalize="none" />
          <button onClick={test} disabled={busy || !testTo} className="btn-ghost shrink-0">发送</button>
        </div>
      </div>
    </div>
  )
}
