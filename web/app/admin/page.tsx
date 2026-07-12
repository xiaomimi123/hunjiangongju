'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { StatusPill } from '@/components/ui'
import PageHeader from '@/components/admin/PageHeader'
import StatCard from '@/components/admin/StatCard'

type Overview = {
  stats: { totalStudents: number; todayNew: number; totalTasks: number; exportedTasks: number; materials: number; images: number; scripts: number; publishedScripts: number }
  attention: { materialPending: number; previewPending: number; qcFailed: number; failed: number }
  funnel: { processing: number; waiting: number; done: number; failed: number }
  recent: { id: string; status: string; createdAt: string; title: string; who: string }[]
}

export default function DashboardPage() {
  const [d, setD] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<Overview>('/api/admin/overview').then(setD).catch((e) => setErr((e as Error).message)) }, [])

  const s = d?.stats
  const attn = d?.attention
  const attnTotal = attn ? attn.materialPending + attn.previewPending + attn.qcFailed + attn.failed : 0
  const f = d?.funnel
  const fTotal = f ? Math.max(1, f.processing + f.waiting + f.done + f.failed) : 1
  const bars: { k: string; v: number; cls: string }[] = f ? [
    { k: '处理中', v: f.processing, cls: 'bg-flame' },
    { k: '待处理', v: f.waiting, cls: 'bg-warn' },
    { k: '已完成', v: f.done, cls: 'bg-ok' },
    { k: '失败', v: f.failed, cls: 'bg-bad' },
  ] : []

  return (
    <div>
      <PageHeader title="仪表盘" subtitle="平台运营总览">
        <Link href="/admin/materials" className="btn-ghost">上传素材</Link>
        <Link href="/admin/scripts" className="btn-primary">新建文案</Link>
      </PageHeader>
      {err && <p className="pill pill-bad mb-4">{err}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="学员总数" value={s?.totalStudents ?? '—'} hint={s ? `今日新增 ${s.todayNew}` : ''} accent />
        <StatCard label="生成任务" value={s?.totalTasks ?? '—'} hint={s ? `已出成片 ${s.exportedTasks}` : ''} />
        <StatCard label="素材库" value={s?.materials ?? '—'} hint={s ? `其中图片 ${s.images}` : ''} />
        <StatCard label="文案模版" value={s?.publishedScripts ?? '—'} hint={s ? `共 ${s.scripts} 篇` : ''} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* 待处理事项 */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">待处理事项</p>
            {attnTotal > 0 && <span className="pill pill-warn"><span className="num">{attnTotal}</span></span>}
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            <AttnRow label="等待补充素材" value={attn?.materialPending} href="/admin/tasks?status=MATERIAL_PENDING" tone="warn" />
            <AttnRow label="待学员预览" value={attn?.previewPending} tone="warn" />
            <AttnRow label="质检未通过" value={attn?.qcFailed} tone="bad" />
            <AttnRow label="生成失败" value={attn?.failed} href="/admin/tasks?status=FAILED" tone="bad" />
          </ul>
          {attnTotal === 0 && <p className="mt-3 rounded-xl bg-surface2 py-4 text-center text-sm text-ink3">一切正常，暂无待办 🎉</p>}
        </div>

        {/* 任务分布 */}
        <div className="card p-5">
          <p className="eyebrow">任务状态分布</p>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface2">
            {bars.filter((b) => b.v > 0).map((b) => (
              <div key={b.k} className={b.cls} style={{ width: `${(b.v / fTotal) * 100}%` }} title={`${b.k} ${b.v}`} />
            ))}
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {bars.map((b) => (
              <li key={b.k} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink2"><span className={`h-2.5 w-2.5 rounded-full ${b.cls}`} />{b.k}</span>
                <span className="num text-ink">{b.v}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 近期任务 */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">近期任务</p>
            <Link href="/admin/tasks" className="text-sm text-flame">全部</Link>
          </div>
          <ul className="mt-3 space-y-2">
            {d?.recent.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/tasks/${t.id}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 transition hover:bg-surface2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-ink3">{t.who}</span>
                  </span>
                  <StatusPill status={t.status} />
                </Link>
              </li>
            ))}
            {d && d.recent.length === 0 && <li className="rounded-xl bg-surface2 py-6 text-center text-sm text-ink3">还没有任务</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}

function AttnRow({ label, value, href, tone }: { label: string; value?: number; href?: string; tone: 'warn' | 'bad' }) {
  const v = value ?? 0
  const body = (
    <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${v > 0 ? 'bg-surface2' : ''}`}>
      <span className={v > 0 ? 'text-ink2' : 'text-ink3'}>{label}</span>
      <span className={`num font-semibold ${v > 0 ? (tone === 'bad' ? 'text-bad' : 'text-warn') : 'text-ink3'}`}>{v}</span>
    </div>
  )
  return <li>{href && v > 0 ? <Link href={href}>{body}</Link> : body}</li>
}
