'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

type Cfg = { host: string; port: number; secure: boolean; username: string; fromAddress: string; fromName: string; enabled: boolean; hasPassword: boolean; registrationOpen: boolean }

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [password, setPassword] = useState('')
  const [testTo, setTestTo] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // 导师收款二维码：学员积分用完时弹窗展示
  const [qrUrl, setQrUrl] = useState('')
  const [qrErr, setQrErr] = useState('')
  const [qrBusy, setQrBusy] = useState(false)

  useEffect(() => {
    api<Cfg>('/api/admin/smtp').then(setCfg).catch((e) => setErr((e as Error).message))
    api<{ qrUrl: string }>('/api/admin/recharge-qr').then((r) => setQrUrl(r.qrUrl)).catch(() => {})
  }, [])

  async function uploadQr(file: File) {
    setQrBusy(true); setQrErr('')
    try {
      const form = new FormData()
      form.set('file', file)
      const r = await api<{ qrUrl: string }>('/api/admin/recharge-qr', { form })
      setQrUrl(r.qrUrl)
    } catch (e) { setQrErr((e as Error).message) } finally { setQrBusy(false) }
  }
  async function removeQr() {
    setQrBusy(true); setQrErr('')
    try { await api('/api/admin/recharge-qr', { method: 'DELETE' }); setQrUrl('') }
    catch (e) { setQrErr((e as Error).message) } finally { setQrBusy(false) }
  }

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
    <div className="space-y-4">
      <PageHeader title="系统设置" subtitle="充值二维码与邮件服务" />
      {err && <p className="pill pill-bad">{err}</p>}
      {msg && <p className="pill pill-ok">{msg}</p>}

      <Link href="/admin/settings/fonts" className="card flex items-center justify-between p-4 hover:bg-surface2">
        <span className="font-medium">字体管理 · 内置字体清单与自定义字体上传</span>
        <span className="text-sm text-flame">进入 →</span>
      </Link>

      <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <p className="font-medium">学员充值二维码</p>
        <p className="text-xs text-ink3">学员积分用完时弹出此二维码（导师微信收款码）。1 条视频 = 1 积分，收款后到「学员数据」页给对应学员充值。</p>
        {qrUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={qrUrl} alt="充值二维码" className="w-44 rounded-xl border border-line" />
          : <p className="rounded-xl bg-surface2 px-4 py-6 text-center text-sm text-ink3">未上传，学员端将只提示「请联系导师充值」</p>}
        <div className="flex items-center gap-3">
          <label className="btn-ghost cursor-pointer text-sm">
            {qrBusy ? '处理中…' : qrUrl ? '更换图片' : '上传图片'}
            <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" disabled={qrBusy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadQr(f); e.target.value = '' }} />
          </label>
          {qrUrl && <button onClick={removeQr} disabled={qrBusy} className="text-sm text-bad">移除</button>}
        </div>
        {qrErr && <p className="pill pill-bad">{qrErr}</p>}
      </div>

      <div className="card space-y-3 p-4">
        <label className="flex items-center justify-between">
          <span className="font-medium">启用邮件服务</span>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => up('enabled', e.target.checked)} className="h-5 w-5" />
        </label>
        <p className="text-xs text-ink3">关闭时：注册直接可用、忘记密码不可用。开启时：注册需邮箱验证码、支持忘记密码。</p>
        <label className="flex items-center justify-between">
          <span className="font-medium">开放注册</span>
          <input type="checkbox" checked={cfg.registrationOpen} onChange={(e) => up('registrationOpen', e.target.checked)} className="h-5 w-5" />
        </label>
        <p className="text-xs text-ink3">关闭时：登录页不显示「注册」标签，新用户无法自助注册。</p>
      </div>
      </div>

      {/* 邮件服务配置：现行账号体系是手机号，邮箱验证码链路早已停用（410），
          这套 SMTP 配置平时用不到——收进折叠，别让它撑出一屏留白 */}
      <details className="card p-4">
        <summary className="cursor-pointer select-none text-sm font-medium text-ink2">
          邮件服务配置（SMTP）· 现行手机号账号体系一般无需配置，点开编辑
        </summary>
        <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">
      <div className="grid gap-3">
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

      <div className="space-y-3">
        <p className="eyebrow">发送测试邮件</p>
        <div className="flex gap-3">
          <input className="field" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="收件邮箱" autoCapitalize="none" />
          <button onClick={test} disabled={busy || !testTo} className="btn-ghost shrink-0">发送</button>
        </div>
      </div>
        </div>
      </details>
    </div>
  )
}
