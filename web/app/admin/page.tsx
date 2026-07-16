'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { GenPill } from './generate/genStatus'
import PageHeader from '@/components/admin/PageHeader'
import StatCard from '@/components/admin/StatCard'

type Overview = {
  stats: {
    totalStudents: number; todayNew: number
    sourceVideos: number; frameworks: number; publishedFrameworks: number
    generationTasks: number; exportedWorks: number; publishedWorks: number
  }
  attention: { sourceFailed: number; genPreviewPending: number; genFailed: number; renderFailed: number }
  funnel: { processing: number; waiting: number; done: number; failed: number }
  recent: { id: string; status: string; createdAt: string; title: string; who: string }[]
}

export default function DashboardPage() {
  const [d, setD] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<Overview>('/api/admin/overview').then(setD).catch((e) => setErr((e as Error).message)) }, [])

  const s = d?.stats
  const attn = d?.attention
  const attnTotal = attn ? attn.sourceFailed + attn.genPreviewPending + attn.genFailed + attn.renderFailed : 0
  const f = d?.funnel
  const fTotal = f ? Math.max(1, f.processing + f.waiting + f.done + f.failed) : 1
  const bars: { k: string; v: number; cls: string }[] = f ? [
    { k: '生成中', v: f.processing, cls: 'bg-flame' },
    { k: '待处理', v: f.waiting, cls: 'bg-warn' },
    { k: '已完成', v: f.done, cls: 'bg-ok' },
    { k: '失败', v: f.failed, cls: 'bg-bad' },
  ] : []

  return (
    <div>
      <PageHeader title="仪表盘" subtitle="拆解 / 生成 运营总览">
        <Link href="/admin/extract" className="btn-ghost">拆解视频</Link>
        <Link href="/admin/generate" className="btn-primary">发起生成</Link>
      </PageHeader>
      {err && <p className="pill pill-bad mb-4">{err}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="学员总数" value={s?.totalStudents ?? '—'} hint={s ? `今日新增 ${s.todayNew}` : ''} accent />
        <StatCard label="拆解源视频" value={s?.sourceVideos ?? '—'} hint={s ? `已产框架 ${s.publishedFrameworks}/${s.frameworks}` : ''} />
        <StatCard label="生成任务" value={s?.generationTasks ?? '—'} hint={s ? `已出成片 ${s.exportedWorks}` : ''} />
        <StatCard label="已发布成片" value={s?.publishedWorks ?? '—'} hint={s ? `完成 ${s.exportedWorks} 条` : ''} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* 待处理事项 */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">待处理事项</p>
            {attnTotal > 0 && <span className="pill pill-warn"><span className="num">{attnTotal}</span></span>}
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            <AttnRow label="源视频拆解失败" value={attn?.sourceFailed} href="/admin/extract" tone="bad" />
            <AttnRow label="待预览确认" value={attn?.genPreviewPending} href="/admin/generate" tone="warn" />
            <AttnRow label="生成失败" value={attn?.genFailed} href="/admin/generate" tone="bad" />
            <AttnRow label="渲染失败" value={attn?.renderFailed} href="/admin/generate" tone="bad" />
          </ul>
          {attnTotal === 0 && <p className="mt-3 rounded-xl bg-surface2 py-4 text-center text-sm text-ink3">一切正常，暂无待办 🎉</p>}
        </div>

        {/* 生成任务分布 */}
        <div className="card p-5">
          <p className="eyebrow">生成任务分布</p>
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

        {/* 近期生成任务 */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">近期生成任务</p>
            <Link href="/admin/generate" className="text-sm text-flame">全部</Link>
          </div>
          <ul className="mt-3 space-y-2">
            {d?.recent.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/generate/${t.id}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 transition hover:bg-surface2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-ink3">{t.who}</span>
                  </span>
                  <GenPill status={t.status} />
                </Link>
              </li>
            ))}
            {d && d.recent.length === 0 && <li className="rounded-xl bg-surface2 py-6 text-center text-sm text-ink3">还没有生成任务</li>}
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
