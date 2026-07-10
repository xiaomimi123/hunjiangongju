'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS, isTerminal } from '@/lib/status'
import { StatusPill, PipelineRail } from '@/components/ui'

type Task = {
  id: string; status: string; aspectRatio: string
  script: { title: string } | null
  statusLogs: { id: string; toStatus: string; note: string | null; createdAt: string }[]
  exports: { videoUrl: string; subtitleUrl: string; projectJsonUrl: string }[]
}

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<Task | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const t = await api<Task>(`/api/tasks/${id}`)
      setTask(t)
      return t
    } catch (e) {
      setErr((e as Error).message)
      return null
    }
  }, [id])

  useEffect(() => {
    load()
    const timer = setInterval(async () => {
      const t = await load()
      if (!t || isTerminal(t.status)) clearInterval(timer)
    }, 3000)
    return () => clearInterval(timer)
  }, [load])

  async function act(path: string) {
    setErr('')
    try { await api(`/api/tasks/${id}/${path}`, { method: 'POST' }); await load() }
    catch (e) { setErr((e as Error).message) }
  }

  if (!task && err) {
    return (
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/works" className="text-sm text-flame">← 返回作品列表</Link>
      </div>
    )
  }
  if (!task) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>
  const exp = task.exports[0]
  const showDraft = ['PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED', 'QC_FAILED'].includes(task.status)
  const showVideo = showDraft || task.status === 'EXPORTED'
  const vertical = task.aspectRatio === '9:16'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{task.script?.title ?? '作品详情'}</h1>
          <p className="num mt-1 text-xs text-ink3">{vertical ? '竖屏 9:16' : '横屏 16:9'}</p>
        </div>
        <StatusPill status={task.status} />
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card p-4">
        <PipelineRail status={task.status} />
      </div>

      {showVideo && (
        <div className="overflow-hidden rounded-3xl bg-black shadow-card">
          <video controls playsInline
            className={`mx-auto w-full bg-black object-contain ${vertical ? 'max-h-[62vh]' : 'aspect-video'}`}
            src={task.status === 'EXPORTED' && exp ? exp.videoUrl : `/api/files/exports/${task.id}/draft.mp4`} />
        </div>
      )}

      {task.status === 'PREVIEW_PENDING' && (
        <button onClick={() => act('confirm-preview')} className="btn-primary w-full">确认无误，提交质检</button>
      )}
      {task.status === 'FAILED' && (
        <button onClick={() => act('retry')} className="btn-ghost w-full">失败重试</button>
      )}
      {task.status === 'EXPORTED' && exp && (
        <div className="space-y-2.5">
          <a href={exp.videoUrl} download className="btn-primary w-full">下载成片 MP4</a>
          <div className="flex gap-2.5 text-sm">
            <a href={exp.subtitleUrl} download className="btn-ghost flex-1">字幕 SRT</a>
            <a href={exp.projectJsonUrl} download className="btn-ghost flex-1">项目 JSON</a>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <p className="eyebrow">处理进度</p>
        <ol className="card divide-y divide-line">
          {[...task.statusLogs].reverse().map((l, i) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'grad' : 'bg-line'}`} />
                <span className="text-sm">
                  {STATUS_LABELS[l.toStatus] ?? l.toStatus}
                  {l.note ? <span className="text-ink3">（{l.note}）</span> : null}
                </span>
              </div>
              <span className="num shrink-0 text-xs text-ink3">{new Date(l.createdAt).toLocaleTimeString('zh-CN')}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
