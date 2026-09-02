'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'
import BottomSheet from '@/components/BottomSheet'

type Me = { email: string; nickname: string | null; role: string }
type Wallet = { credits: number; qrUrl: string }

// 手机号打码：138****2210——账号列存的是手机号（见 phone-account-system），
// 非 11 位（如脏数据/邮箱残留）原样展示，不强行打码出错误结果。
function maskPhone(v: string | undefined | null): string {
  if (!v) return '—'
  if (!/^\d{11}$/.test(v)) return v
  return `${v.slice(0, 3)}****${v.slice(7)}`
}

export default function MePage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [err, setErr] = useState('')
  const [showRecharge, setShowRecharge] = useState(false)

  // 修改密码弹层
  const [pwOpen, setPwOpen] = useState(false)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Me>('/api/auth/me').then(setMe).catch((e) => setErr((e as Error).message))
    api<Wallet>('/api/credits').then(setWallet).catch(() => {})
  }, [])

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

      {/* 顶部卡：圆形渐变头像（昵称首字）+ 昵称 + 打码手机号 */}
      <div className="card flex items-center gap-3.5 p-5">
        <span className="grad flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full text-xl font-bold text-white shadow-lift">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.95rem] font-bold">{me?.nickname ?? '学员'}</p>
          <p className="mt-0.5 truncate text-[0.7rem] text-ink3">{maskPhone(me?.email)}</p>
        </div>
      </div>

      {/* 红色渐变积分卡：剩余积分 + 联系导师充值 */}
      <div className="grad flex items-center justify-between rounded-[20px] p-[18px] text-white shadow-lift">
        <div>
          <p className="text-[0.7rem] opacity-80">剩余积分</p>
          <b className="text-[1.6rem]">{wallet?.credits ?? '--'}</b>
        </div>
        <button
          onClick={() => setShowRecharge(true)}
          className="rounded-full bg-white/[0.18] px-4 py-2 text-[0.75rem]"
        >
          联系导师充值
        </button>
      </div>

      {/* 入口列表卡 */}
      <div className="card divide-y divide-line">
        <button onClick={() => router.push('/library')} className="flex w-full items-center justify-between px-4 py-3.5 text-left transition active:bg-surface2">
          <span className="text-sm text-ink2">我的成片库</span>
          <span className="text-ink3">›</span>
        </button>
        <button onClick={() => router.push('/tools/runs')} className="flex w-full items-center justify-between px-4 py-3.5 text-left transition active:bg-surface2">
          <span className="text-sm text-ink2">工具运行记录</span>
          <span className="text-ink3">›</span>
        </button>
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

      {/* 积分充值二维码弹层：样式与 templates/tools/[id] 页 NO_CREDITS 弹层保持一致 */}
      {showRecharge && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => setShowRecharge(false)}>
          <div className="card w-full max-w-sm space-y-4 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-display text-lg font-bold">积分充值</h3>
              <p className="mt-1 text-sm text-ink3">
                1 条视频消耗 1 积分。扫码添加导师微信充值，到账后即可继续生成
              </p>
            </div>
            {wallet?.qrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={wallet.qrUrl} alt="导师微信二维码" className="mx-auto w-56 max-w-full rounded-xl" />
            ) : (
              <p className="rounded-xl bg-surface2 px-4 py-8 text-sm text-ink3">请联系你的导师充值</p>
            )}
            <button onClick={() => setShowRecharge(false)} className="btn-ghost w-full">知道了</button>
          </div>
        </div>
      )}
    </div>
  )
}
