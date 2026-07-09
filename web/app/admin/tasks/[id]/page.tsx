'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS, isTerminal } from '@/lib/status'
import BottomSheet from '@/components/BottomSheet'

type Seg = {
  id: string; orderNo: number; startMs: number; endMs: number | null
  subtitleText: string | null; materialId: string | null
  material: { id: string; fileUrl: string; thumbnailUrl: string | null } | null
  segment: { text: string; tags: { tagId: string }[] } | null
}
type Task = {
  id: string; status: string; aspectRatio: string
  script: { title: string } | null
  segments: Seg[]
  qcReports: { id: string; checkType: string; result: string; detail: string | null }[]
  statusLogs: { id: string; toStatus: string; note: string | null; createdAt: string }[]
  exports: { videoUrl: string }[]
}
type Material = { id: string; thumbnailUrl: string | null; durationMs: number | null; tags: { tagId: string }[] }

const QC_NAMES: Record<string, string> = {
  black_frame: '黑屏检测', silence: '静音检测', subtitle_overflow: '字幕越界',
}

export default function AdminTaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<Task | null>(null)
  const [subs, setSubs] = useState<Record<string, string>>({})
  const [mats, setMats] = useState<Record<string, string>>({})
  const [order, setOrder] = useState<string[]>([])
  const [picking, setPicking] = useState<Seg | null>(null)
  const [allMaterials, setAllMaterials] = useState<Material[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const dirtyRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const t = await api<Task>(`/api/tasks/${id}`)
      setTask(t)
      if (!dirtyRef.current) setOrder(t.segments.map((s) => s.id))
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

  useEffect(() => {
    api<Material[]>('/api/materials').then(setAllMaterials).catch((e) => setErr((e as Error).message))
  }, [])

  useEffect(() => {
    dirtyRef.current = !!(task && (
      Object.keys(subs).length + Object.keys(mats).length > 0
        || order.some((sid, i) => task.segments[i]?.id !== sid)
    ))
  }, [task, subs, mats, order])

  async function act(fn: () => Promise<unknown>) {
    setErr(''); setBusy(true)
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  function move(segId: string, dir: -1 | 1) {
    setOrder((o) => {
      const i = o.indexOf(segId)
      const j = i + dir
      if (j < 0 || j >= o.length) return o
      const next = [...o]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function saveRevise() {
    if (!task) return
    const changes = task.segments
      .filter((s) => subs[s.id] !== undefined || mats[s.id] !== undefined)
      .map((s) => ({
        taskSegmentId: s.id,
        ...(subs[s.id] !== undefined ? { subtitleText: subs[s.id] } : {}),
        ...(mats[s.id] !== undefined ? { materialId: mats[s.id] } : {}),
      }))
    const orderChanged = order.some((sid, i) => task.segments[i]?.id !== sid)
    act(() => api(`/api/tasks/${id}/revise`, {
      body: { changes, ...(orderChanged ? { order } : {}) },
    })).then(() => { setSubs({}); setMats({}) })
  }

  function linkMaterial(seg: Seg, materialId: string) {
    act(() => api(`/api/tasks/${id}/segments/${seg.id}/link-material`, { body: { materialId } }))
    setPicking(null)
  }

  if (!task && err) {
    return (
      <div className="space-y-4 p-4">
        <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>
        <Link href="/admin/tasks" className="block text-sm text-blue-600">返回任务列表</Link>
      </div>
    )
  }
  if (!task) return <p>加载中…</p>
  const editable = task.status === 'PREVIEW_PENDING' || task.status === 'QC_FAILED'
  const pending = task.status === 'MATERIAL_PENDING'
  const segMap = new Map(task.segments.map((s) => [s.id, s]))
  const orderedSegs = order.map((sid) => segMap.get(sid)!).filter(Boolean)
  const dirty = Object.keys(subs).length + Object.keys(mats).length > 0
    || order.some((sid, i) => task.segments[i]?.id !== sid)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{task.script?.title ?? '任务详情'}</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <p className="text-sm">状态：<span className="font-medium text-blue-600">{STATUS_LABELS[task.status] ?? task.status}</span></p>

      {['PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED', 'QC_FAILED', 'EXPORTED'].includes(task.status) && (
        <video controls playsInline className="w-full rounded-xl bg-black"
          src={task.status === 'EXPORTED' && task.exports[0] ? task.exports[0].videoUrl : `/api/files/exports/${task.id}/draft.mp4`} />
      )}

      {pending && (
        <Link href={`/admin/materials?returnTaskId=${task.id}`}
          className="block rounded-xl bg-amber-500 py-3 text-center text-white">
          素材不足 → 去素材库上传
        </Link>
      )}

      <section className="space-y-3">
        <h2 className="text-sm text-gray-500">分镜（{orderedSegs.length} 段）</h2>
        {orderedSegs.map((seg, i) => {
          const missing = !seg.materialId && !mats[seg.id]
          const mat = mats[seg.id]
            ? allMaterials.find((m) => m.id === mats[seg.id])
            : seg.material
          return (
            <div key={seg.id}
              className={`rounded-xl border bg-white p-3 ${missing && pending ? 'border-amber-400 bg-amber-50' : ''}`}>
              <div className="flex gap-3">
                {mat && 'thumbnailUrl' in mat && mat.thumbnailUrl
                  ? <img src={mat.thumbnailUrl} alt="" className="h-16 w-24 rounded object-cover" />
                  : <div className="flex h-16 w-24 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">无素材</div>}
                <div className="flex-1">
                  <p className="text-xs text-gray-400">#{i + 1}</p>
                  {editable ? (
                    <textarea rows={2} defaultValue={seg.subtitleText ?? ''}
                      onChange={(e) => setSubs((s) => ({ ...s, [seg.id]: e.target.value }))}
                      className="w-full rounded border px-2 py-1 text-sm" />
                  ) : (
                    <p className="text-sm">{seg.subtitleText}</p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex gap-2 text-sm">
                {(editable || pending) && (
                  <button onClick={() => setPicking(seg)} className="rounded-lg border px-3 py-1">
                    {pending ? '关联素材' : '换素材'}
                  </button>
                )}
                {editable && (
                  <>
                    <button onClick={() => move(seg.id, -1)} className="rounded-lg border px-3 py-1">上移</button>
                    <button onClick={() => move(seg.id, 1)} className="rounded-lg border px-3 py-1">下移</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </section>

      {editable && (
        <div className="space-y-2">
          <button onClick={saveRevise} disabled={!dirty || busy}
            className="w-full rounded-xl bg-blue-600 py-3 text-white disabled:opacity-40">
            保存修改并重新渲染
          </button>
          {task.status === 'PREVIEW_PENDING' && (
            <button onClick={() => act(() => api(`/api/tasks/${id}/confirm-preview`, { method: 'POST' }))}
              disabled={busy || dirty}
              className="w-full rounded-xl bg-green-600 py-3 text-white disabled:opacity-40">
              确认无误，提交质检
            </button>
          )}
          {task.status === 'QC_FAILED' && (
            <button onClick={() => act(() => api(`/api/tasks/${id}/retry-qc`, { method: 'POST' }))}
              disabled={busy || dirty}
              className="w-full rounded-xl bg-orange-500 py-3 text-white disabled:opacity-40">
              直接重新质检
            </button>
          )}
        </div>
      )}

      {task.qcReports.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm text-gray-500">质检报告（最近一轮）</h2>
          <ul className="space-y-1 rounded-xl border bg-white p-3 text-sm">
            {task.qcReports.slice(0, 3).map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>{QC_NAMES[r.checkType] ?? r.checkType}</span>
                <span className={r.result === 'pass' ? 'text-green-600' : 'text-red-500'}>
                  {r.result === 'pass' ? '通过' : `不通过：${r.detail ?? ''}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm text-gray-500">状态日志</h2>
        <ul className="space-y-1 rounded-xl border bg-white p-3 text-xs text-gray-600">
          {task.statusLogs.map((l) => (
            <li key={l.id}>{new Date(l.createdAt).toLocaleTimeString('zh-CN')} → {STATUS_LABELS[l.toStatus] ?? l.toStatus}{l.note ? `（${l.note}）` : ''}</li>
          ))}
        </ul>
      </section>

      <BottomSheet open={!!picking} onClose={() => setPicking(null)} title="选择素材">
        <ul className="grid grid-cols-3 gap-2">
          {allMaterials
            .slice()
            .sort((a, b) => {
              const tags = new Set((picking?.segment?.tags ?? []).map((t) => t.tagId))
              const sa = a.tags.filter((t) => tags.has(t.tagId)).length
              const sb = b.tags.filter((t) => tags.has(t.tagId)).length
              return sb - sa
            })
            .map((m) => (
              <button key={m.id} onClick={() => {
                if (!picking) return
                if (pending) linkMaterial(picking, m.id)
                else { setMats((s) => ({ ...s, [picking.id]: m.id })); setPicking(null) }
              }} className="overflow-hidden rounded-lg border">
                {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />}
                <p className="p-1 text-center text-xs text-gray-500">{((m.durationMs ?? 0) / 1000).toFixed(1)}s</p>
              </button>
            ))}
        </ul>
      </BottomSheet>
    </div>
  )
}
