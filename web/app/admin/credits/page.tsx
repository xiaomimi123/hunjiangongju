'use client'
import { useCallback, useEffect, useState } from 'react'
import PageHeader from '@/components/admin/PageHeader'
import StatCard from '@/components/admin/StatCard'
import { formatCredits } from '@/lib/credits'

type Stats = {
  windowDays: number
  summary: { recharge: number; consumed: number; refunded: number }
  byProduct: { video: number; photo: number; tool: number; other: number }
  topConsumers: { email: string; nickname: string | null; consumed: number; credits: number }[]
  dormant: { email: string; nickname: string | null; credits: number; createdAt: string }[]
}
type Log = { id: string; delta: number; reason: string; createdAt: string; email: string; nickname: string | null }

const PRODUCT_LABEL: Record<string, string> = { video: '生成视频', photo: '实拍生图', tool: '扣子工具', other: '其他' }
const PRODUCT_TONE: Record<string, string> = { video: 'bg-flame', photo: 'bg-[#E8A23D]', tool: 'bg-[#3D7BE8]', other: 'bg-ink3' }

function who(email: string, nickname: string | null) {
  return nickname ? `${nickname}（${email}）` : email
}

export default function CreditsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [err, setErr] = useState('')
  const [logs, setLogs] = useState<Log[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/admin/credit-stats').then(async (r) => {
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
      setStats(j)
    }).catch((e) => setErr((e as Error).message))
  }, [])

  const loadLogs = useCallback(async (reset: boolean, qv: string, tv: string, offset: number) => {
    setBusy(true)
    try {
      const params = new URLSearchParams()
      if (qv) params.set('q', qv)
      if (tv) params.set('type', tv)
      if (!reset) params.set('offset', String(offset))
      const r = await fetch(`/api/admin/credit-logs?${params}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
      setLogs((cur) => (reset ? j.logs : [...cur, ...j.logs]))
      setHasMore(j.hasMore)
      setNextOffset(j.nextOffset)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }, [])

  useEffect(() => { loadLogs(true, '', '', 0) }, [loadLogs])

  const totalConsumed = stats ? Math.max(1, stats.summary.consumed) : 1

  return (
    <div className="space-y-5">
      <PageHeader title="积分流水" subtitle={`充值与消耗账本 · 统计窗口近 ${stats?.windowDays ?? 30} 天 · 消费流水自 2026-09-21 起记录`} />
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="充值总额" value={stats ? formatCredits(stats.summary.recharge) : '…'} hint="积分 · 近 30 天" accent />
        <StatCard label="消耗总额" value={stats ? formatCredits(stats.summary.consumed) : '…'} hint="积分 · 近 30 天" />
        <StatCard label="失败退回" value={stats ? formatCredits(stats.summary.refunded) : '…'} hint="积分 · 近 30 天" />
      </div>

      {stats && stats.summary.consumed > 0 && (
        <div className="card space-y-2.5 p-4">
          <p className="font-medium">消耗构成</p>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface2">
            {(['video', 'photo', 'tool', 'other'] as const).map((k) =>
              stats.byProduct[k] > 0 ? (
                <span key={k} className={PRODUCT_TONE[k]} style={{ width: `${(stats.byProduct[k] / totalConsumed) * 100}%` }} />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink2">
            {(['video', 'photo', 'tool', 'other'] as const).map((k) =>
              stats.byProduct[k] > 0 ? (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${PRODUCT_TONE[k]}`} />
                  {PRODUCT_LABEL[k]} <span className="num font-medium">{formatCredits(stats.byProduct[k])}</span>
                  <span className="text-ink3">（{Math.round((stats.byProduct[k] / totalConsumed) * 100)}%）</span>
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <p className="font-medium">消耗大户 <span className="text-xs font-normal text-ink3">近 30 天消耗 Top 10</span></p>
          <div className="mt-2 divide-y divide-line">
            {(stats?.topConsumers ?? []).map((u, i) => (
              <div key={u.email} className="flex items-center gap-3 py-2 text-sm">
                <span className={`num w-5 text-center text-xs font-bold ${i < 3 ? 'text-flame' : 'text-ink3'}`}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{who(u.email, u.nickname)}</span>
                <span className="num font-medium">-{formatCredits(u.consumed)}</span>
                <span className="num w-20 text-right text-xs text-ink3">余 {formatCredits(u.credits)}</span>
              </div>
            ))}
            {stats && stats.topConsumers.length === 0 && <p className="py-4 text-center text-xs text-ink3">窗口内暂无消耗</p>}
          </div>
        </div>

        <div className="card p-4">
          <p className="font-medium">沉睡户 <span className="text-xs font-normal text-ink3">有余额但近 30 天没做过片/工具/生图</span></p>
          <div className="mt-2 divide-y divide-line">
            {(stats?.dormant ?? []).map((u) => (
              <div key={u.email} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{who(u.email, u.nickname)}</span>
                <span className="num font-medium">余 {formatCredits(u.credits)}</span>
                <span className="w-24 text-right text-xs text-ink3">{new Date(u.createdAt).toLocaleDateString()} 注册</span>
              </div>
            ))}
            {stats && stats.dormant.length === 0 && <p className="py-4 text-center text-xs text-ink3">没有沉睡学员，都活跃着</p>}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="mr-auto font-medium">全站流水</p>
          <select className="field w-32 py-1.5 text-sm" value={type}
            onChange={(e) => { setType(e.target.value); loadLogs(true, q, e.target.value, 0) }}>
            <option value="">全部类型</option>
            <option value="recharge">充值</option>
            <option value="consume">消耗</option>
            <option value="refund">退回</option>
          </select>
          <input className="field w-52 py-1.5 text-sm" placeholder="搜手机号/昵称" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadLogs(true, q, type, 0) }} />
          <button onClick={() => loadLogs(true, q, type, 0)} disabled={busy} className="btn-quiet text-sm">查询</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-left text-ink3">
              <tr>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">学员</th>
                <th className="px-3 py-2 text-right font-medium">积分</th>
                <th className="px-3 py-2 font-medium">事由</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="num whitespace-nowrap px-3 py-2 text-xs text-ink3">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="max-w-[220px] truncate px-3 py-2">{who(l.email, l.nickname)}</td>
                  <td className={`num whitespace-nowrap px-3 py-2 text-right font-medium ${l.delta > 0 ? 'text-ok' : 'text-ink'}`}>
                    {l.delta > 0 ? '+' : ''}{formatCredits(l.delta)}
                  </td>
                  <td className="px-3 py-2 text-ink2">{l.reason === 'recharge' ? '充值' : l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && !busy && <p className="py-6 text-center text-sm text-ink3">没有符合条件的流水</p>}
        </div>
        {hasMore && (
          <button onClick={() => loadLogs(false, q, type, nextOffset)} disabled={busy}
            className="btn-ghost mt-3 w-full text-sm">{busy ? '加载中…' : '加载更多'}</button>
        )}
      </div>
    </div>
  )
}
