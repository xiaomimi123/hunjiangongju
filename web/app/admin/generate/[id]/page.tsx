'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import { GenPill, genIsTerminal } from '../genStatus'

type Segment = { seqNo: number; scriptText: string; imageUrl: string | null }
type RenderTask = { id: string; status: string; videoUrl: string | null; subtitleUrl: string | null }
type Timing = { seqNo: number; startMs: number; endMs: number }
type GenTask = {
  id: string; subject: string; status: string
  framework: { id: string; name: string | null } | null
  segments: Segment[]
  bodyTimings: Timing[] | null
  renderTasks: RenderTask[]
}

export default function GenerateDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<GenTask | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { const t = await api<GenTask>(`/api/generate/${id}`); setTask(t); return t }
    catch (e) { setErr((e as Error).message); return null }
  }, [id])

  useEffect(() => {
    load()
    const timer = setInterval(async () => {
      const t = await load()
      if (!t || genIsTerminal(t.status)) clearInterval(timer)
    }, 3000)
    return () => clearInterval(timer)
  }, [load])

  async function act(path: string, key: string) {
    setErr(''); setBusy(key)
    try { await api(`/api/generate/${id}/${path}`, { method: 'POST' }); await load() }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  if (!task && err) {
    return (
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/admin/generate" className="text-sm text-flame">← 返回生成列表</Link>
      </div>
    )
  }
  if (!task) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>

  const ready = task.status === 'ASSET_READY'
  const rt = task.renderTasks[0]
  const preview = task.renderTasks.find((r) => r.videoUrl)

  return (
    <div className="space-y-5">
      <PageHeader title={task.subject} subtitle={task.framework?.name ? `框架：${task.framework.name}` : undefined}>
        <Link href="/admin/generate" className="btn-ghost">返回列表</Link>
      </PageHeader>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="eyebrow">当前状态</span>
          <GenPill status={task.status} />
          {!genIsTerminal(task.status) && <span className="text-xs text-ink3">处理中，自动刷新…</span>}
        </div>
        {ready && (
          <button onClick={() => act('render', 'render')} disabled={busy === 'render'} className="btn-primary">
            {busy === 'render' ? '提交中…' : '确认合成'}
          </button>
        )}
      </div>

      {preview && (
        <div className="space-y-3">
          <p className="eyebrow">成片预览</p>
          <div className="overflow-hidden rounded-3xl bg-black shadow-card">
            <video controls playsInline className="mx-auto max-h-[62vh] w-full bg-black object-contain" src={preview.videoUrl!} />
          </div>
          <div className="flex gap-2.5 text-sm">
            <a href={preview.videoUrl!} download className="btn-primary flex-1">下载成片 MP4</a>
            {preview.subtitleUrl && <a href={preview.subtitleUrl} download className="btn-ghost flex-1">字幕 SRT</a>}
          </div>
        </div>
      )}

      {rt && !preview && (
        <div className="card flex items-center gap-3 p-4">
          <span className="eyebrow">合成进度</span>
          <GenPill status={rt.status} />
        </div>
      )}

      <section className="space-y-3">
        <p className="eyebrow">分段（{task.segments.length}）</p>
        {task.segments.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink3">文案生成中，分段稍后出现…</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {task.segments.map((s) => (
              <div key={s.seqNo} className="card overflow-hidden">
                <div className="relative aspect-[3/4] bg-surface2">
                  {s.imageUrl
                    ? <img src={s.imageUrl} alt={`第${s.seqNo}段`} className="h-full w-full object-cover" />
                    : <div className="grid h-full w-full place-items-center text-xs text-ink3">图片生成中…</div>}
                  <span className="num absolute left-2 top-2 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] text-white">#{s.seqNo}</span>
                </div>
                <div className="space-y-2 p-3">
                  <p className="line-clamp-3 text-sm text-ink2">{s.scriptText}</p>
                  <button
                    onClick={() => act(`segments/${s.seqNo}/regenerate`, `seg-${s.seqNo}`)}
                    disabled={!ready || busy === `seg-${s.seqNo}`}
                    className="btn-ghost w-full text-xs disabled:opacity-50"
                  >
                    {busy === `seg-${s.seqNo}` ? '重生中…' : '重新生成'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
