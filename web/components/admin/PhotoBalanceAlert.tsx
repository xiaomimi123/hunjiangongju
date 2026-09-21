'use client'
// 生图服务余额告警横幅：挂在后台 layout，任何后台页面都能第一眼看到。
// 数据源 /api/admin/photo-health（无状态探针）；充值后有新的成功生成即自动消失。
import { useEffect, useState } from 'react'

type Alert = { balance: string | null; failedCount: number; lastAt: string }

export default function PhotoBalanceAlert() {
  const [alert, setAlert] = useState<Alert | null>(null)

  useEffect(() => {
    let stopped = false
    const check = () =>
      fetch('/api/admin/photo-health')
        .then((r) => (r.ok ? r.json() : { alert: null }))
        .then((j) => { if (!stopped) setAlert(j.alert ?? null) })
        .catch(() => {})
    check()
    const timer = setInterval(check, 5 * 60_000) // 后台常开着，5 分钟自查一次
    return () => { stopped = true; clearInterval(timer) }
  }, [])

  if (!alert) return null
  return (
    <div className="mb-5 rounded-2xl border border-bad/30 bg-bad/[0.07] px-4 py-3 text-sm">
      <p className="font-bold text-bad">⚠ 生图服务余额不足，学员生成正在失败</p>
      <p className="mt-0.5 text-xs text-ink2">
        {alert.balance ? `apimart 余额仅剩 $${alert.balance}；` : ''}
        近 6 小时已有 <b className="num">{alert.failedCount}</b> 次生成因此失败（积分已自动退回）。
        请到 apimart 控制台充值——充值后学员生成成功一次，本提示自动消失。
      </p>
    </div>
  )
}
