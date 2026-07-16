'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import { ExtractPill, extractIsTerminal, EXTRACT_FLOW, EXTRACT_LABELS } from '../extractStatus'

type Transcript = { id: string; fullText: string; createdAt: string } | null
type SceneCut = { id: string; cutPointsMs: number[] }
type Framework = { id: string; name: string | null; industryCategory: string | null; createdAt: string }
type Detail = {
  id: string; douyinShareUrl: string; videoFileUrl: string | null; status: string; createdAt: string
  transcript: Transcript; sceneCuts: SceneCut[]; frameworks: Framework[]
}

export default function ExtractDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { const r = await api<Detail>(`/api/extract/${id}`); setD(r); return r }
    catch (e) { setErr((e as Error).message); return null }
  }, [id])

  useEffect(() => {
    let stopped = false
    load()
    const timer = setInterval(async () => {
      const r = await load()
      if (stopped) return
      if (!r || extractIsTerminal(r.status)) { stopped = true; clearInterval(timer) }
    }, 3000)
    return () => { stopped = true; clearInterval(timer) }
  }, [load])

  if (!d && err) {
    return (
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/admin/extract" className="text-sm text-flame">← 返回拆解列表</Link>
      </div>
    )
  }
  if (!d) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>

  const failed = d.status === 'FAILED'
  const working = !extractIsTerminal(d.status)
  const sceneCount = d.sceneCuts.reduce((n, c) => n + (c.cutPointsMs?.length ?? 0), 0)
  const title = d.douyinShareUrl === '(manual-upload)' ? '手动上传拆解' : d.douyinShareUrl
  const doneIdx = EXTRACT_FLOW.indexOf(d.status)

  return (
    <div className="space-y-5">
      <PageHeader title="拆解详情" subtitle={title}>
        <Link href="/admin/extract" className="btn-ghost">返回列表</Link>
      </PageHeader>
      {err && <p className="pill pill-bad">{err}</p>}

      {/* 进度 */}
      <div className="card space-y-4 p-4">
        <div className="flex items-center gap-3">
          <span className="eyebrow">当前状态</span>
          <ExtractPill status={d.status} />
          {working && <span className="text-xs text-ink3">处理中，自动刷新…</span>}
        </div>
        {!failed && (
          <div className="flex flex-wrap gap-2">
            {EXTRACT_FLOW.map((s, i) => (
              <span key={s} className={`pill ${doneIdx >= 0 && i <= doneIdx ? 'pill-ok' : ''}`}>{EXTRACT_LABELS[s]}</span>
            ))}
          </div>
        )}
        {failed && (
          <p className="rounded-xl border-l-4 border-l-bad bg-surface2 p-3 text-sm text-ink2">
            拆解失败。若为链接解析失败，请返回列表改用「上传视频」重试。
          </p>
        )}
      </div>

      {/* 场景切点 */}
      <div className="card flex items-center justify-between p-4 text-sm">
        <span className="eyebrow">场景切点</span>
        <span className="num text-ink">{sceneCount} 个</span>
      </div>

      {/* 转写全文 */}
      <section className="space-y-2">
        <p className="eyebrow">原始转写</p>
        <div className="card p-4 text-sm leading-relaxed text-ink2">
          {d.transcript?.fullText
            ? <p className="whitespace-pre-wrap">{d.transcript.fullText}</p>
            : <p className="text-ink3">转写生成中…</p>}
        </div>
      </section>

      {/* 产出框架 */}
      <section className="space-y-2">
        <p className="eyebrow">产出框架（{d.frameworks.length}）</p>
        {d.frameworks.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink3">框架提炼后出现在这里…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {d.frameworks.map((f) => (
              <div key={f.id} className="card flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{f.name ?? f.id.slice(0, 8)}</p>
                  {f.industryCategory && <p className="text-xs text-ink3">{f.industryCategory}</p>}
                </div>
                <Link href="/admin/frameworks" className="btn-ghost shrink-0 text-xs">查看 / 编辑</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
