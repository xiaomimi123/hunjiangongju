'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS, isTerminal } from '@/lib/status'

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

  if (!task) return <p className="p-4">加载中…</p>
  const exp = task.exports[0]
  const showDraft = ['PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED', 'QC_FAILED'].includes(task.status)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{task.script?.title ?? '作品详情'}</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <p className="text-sm">
        状态：<span className="font-medium text-blue-600">{STATUS_LABELS[task.status] ?? task.status}</span>
        <span className="ml-2 text-xs text-gray-400">{task.aspectRatio === '9:16' ? '竖屏' : '横屏'}</span>
      </p>
      {(showDraft || task.status === 'EXPORTED') && (
        <video controls playsInline className="w-full rounded-xl bg-black"
          src={task.status === 'EXPORTED' && exp ? exp.videoUrl : `/api/files/exports/${task.id}/draft.mp4`} />
      )}
      {task.status === 'PREVIEW_PENDING' && (
        <button onClick={() => act('confirm-preview')}
          className="w-full rounded-xl bg-green-600 py-3 text-white">确认无误，提交质检</button>
      )}
      {task.status === 'FAILED' && (
        <button onClick={() => act('retry')}
          className="w-full rounded-xl bg-orange-500 py-3 text-white">失败重试</button>
      )}
      {task.status === 'EXPORTED' && exp && (
        <div className="space-y-2">
          <a href={exp.videoUrl} download className="block rounded-xl bg-blue-600 py-3 text-center text-white">下载成片 MP4</a>
          <div className="flex gap-2 text-sm">
            <a href={exp.subtitleUrl} download className="flex-1 rounded-lg border bg-white py-2 text-center">字幕 SRT</a>
            <a href={exp.projectJsonUrl} download className="flex-1 rounded-lg border bg-white py-2 text-center">项目 JSON</a>
          </div>
        </div>
      )}
      <section>
        <h2 className="mb-2 text-sm text-gray-500">处理进度</h2>
        <ul className="space-y-1 rounded-xl border bg-white p-3 text-sm">
          {task.statusLogs.map((l) => (
            <li key={l.id} className="flex justify-between">
              <span>{STATUS_LABELS[l.toStatus] ?? l.toStatus}{l.note ? `（${l.note}）` : ''}</span>
              <span className="text-xs text-gray-400">{new Date(l.createdAt).toLocaleTimeString('zh-CN')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
