'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { STATUS_LABELS, isTerminal } from '@/lib/status'
import { StatusPill, PipelineRail } from '@/components/ui'
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
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/admin/tasks" className="text-sm text-flame">← 返回任务列表</Link>
      </div>
    )
  }
  if (!task) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>
  const editable = task.status === 'PREVIEW_PENDING' || task.status === 'QC_FAILED'
  const pending = task.status === 'MATERIAL_PENDING'
  const stuckActive = ['CREATED', 'SEGMENTING', 'MATCHING', 'STORYBOARD_READY', 'RENDERING', 'QC_RUNNING', 'REVISING']
    .includes(task.status)
  const segMap = new Map(task.segments.map((s) => [s.id, s]))
  const orderedSegs = order.map((sid) => segMap.get(sid)!).filter(Boolean)
  const dirty = Object.keys(subs).length + Object.keys(mats).length > 0
    || order.some((sid, i) => task.segments[i]?.id !== sid)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="truncate font-display text-xl font-bold tracking-tight">{task.script?.title ?? '任务详情'}</h1>
        <StatusPill status={task.status} />
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card p-4">
        <PipelineRail status={task.status} />
      </div>

      {stuckActive && (
        <button
          onClick={() => {
            if (!confirm('任务可能已卡住（如后台入队失败），是否重置并从头重试？此操作会中断当前进度。')) return
            act(() => api(`/api/tasks/${id}/retry`, { method: 'POST' }))
          }}
          disabled={busy}
          className="btn-danger w-full"
        >
          重置并重试
        </button>
      )}

      {['PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED', 'QC_FAILED', 'EXPORTED'].includes(task.status) && (
        <div className="overflow-hidden rounded-3xl bg-black shadow-card">
          <video controls playsInline className="w-full bg-black"
            src={task.status === 'EXPORTED' && task.exports[0] ? task.exports[0].videoUrl : `/api/files/exports/${task.id}/draft.mp4`} />
        </div>
      )}

      {pending && (
        <Link href={`/admin/materials?returnTaskId=${task.id}`}
          className="btn-primary w-full">
          素材不足 → 去素材库上传
        </Link>
      )}

      <section className="space-y-3">
        <p className="eyebrow">分镜段 · <span className="num">{orderedSegs.length}</span></p>
        <div className="grid gap-4 md:grid-cols-2">
          {orderedSegs.map((seg, i) => {
            const missing = !seg.materialId && !mats[seg.id]
            const mat = mats[seg.id]
              ? allMaterials.find((m) => m.id === mats[seg.id])
              : seg.material
            const attention = missing && pending
            return (
              <div key={seg.id}
                className={`rounded-3xl border bg-surface p-4 shadow-card transition ${
                  attention ? 'border-warn bg-warn/5' : 'border-line'
                }`}>
                <div className="flex gap-3">
                  {mat && 'thumbnailUrl' in mat && mat.thumbnailUrl
                    ? <img src={mat.thumbnailUrl} alt="" className="h-16 w-24 shrink-0 rounded-xl object-cover" />
                    : <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-surface2 text-xs text-ink3">无素材</div>}
                  <div className="min-w-0 flex-1">
                    <p className="num text-xs text-ink3">#{i + 1}</p>
                    {editable ? (
                      <textarea rows={2} defaultValue={seg.subtitleText ?? ''}
                        onChange={(e) => setSubs((s) => ({ ...s, [seg.id]: e.target.value }))}
                        className="field mt-1 text-sm" />
                    ) : (
                      <p className="mt-1 text-sm text-ink2">{seg.subtitleText}</p>
                    )}
                  </div>
                </div>
                {(editable || pending) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => setPicking(seg)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink2 transition active:scale-[0.98]">
                      🔄 {pending ? '关联素材' : '换素材'}
                    </button>
                    {editable && (
                      <>
                        <button onClick={() => move(seg.id, -1)}
                          className="inline-flex h-10 items-center gap-1 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink2 transition active:scale-[0.98]">
                          ↑ 上移
                        </button>
                        <button onClick={() => move(seg.id, 1)}
                          className="inline-flex h-10 items-center gap-1 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink2 transition active:scale-[0.98]">
                          ↓ 下移
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {editable && (
        <div className="space-y-2.5">
          <button onClick={saveRevise} disabled={!dirty || busy}
            className="btn-primary w-full">
            保存修改并重新渲染
          </button>
          {task.status === 'PREVIEW_PENDING' && (
            <button onClick={() => act(() => api(`/api/tasks/${id}/confirm-preview`, { method: 'POST' }))}
              disabled={busy || dirty}
              className="btn-ghost w-full">
              确认无误，提交质检
            </button>
          )}
          {task.status === 'QC_FAILED' && (
            <button onClick={() => act(() => api(`/api/tasks/${id}/retry-qc`, { method: 'POST' }))}
              disabled={busy || dirty}
              className="btn-ghost w-full">
              直接重新质检
            </button>
          )}
        </div>
      )}

      {task.qcReports.length > 0 && (
        <section className="space-y-3">
          <p className="eyebrow">质检报告 · 最近一轮</p>
          <ul className="card divide-y divide-line">
            {task.qcReports.slice(0, 3).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>{QC_NAMES[r.checkType] ?? r.checkType}</span>
                <span className={r.result === 'pass' ? 'pill pill-ok' : 'pill pill-bad'}>
                  {r.result === 'pass' ? '通过' : `不通过：${r.detail ?? ''}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <p className="eyebrow">状态日志</p>
        <ul className="card divide-y divide-line px-4">
          {task.statusLogs.map((l) => (
            <li key={l.id} className="py-2.5 text-xs text-ink2">
              <span className="num text-ink3">{new Date(l.createdAt).toLocaleTimeString('zh-CN')}</span> → {STATUS_LABELS[l.toStatus] ?? l.toStatus}{l.note ? `（${l.note}）` : ''}
            </li>
          ))}
        </ul>
      </section>

      <BottomSheet open={!!picking} onClose={() => setPicking(null)} title="选择素材">
        <ul className="grid grid-cols-3 gap-2.5">
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
              }} className="overflow-hidden rounded-2xl border border-line bg-surface transition active:scale-[0.98]">
                {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />}
                <p className="num p-1.5 text-center text-xs text-ink3">{((m.durationMs ?? 0) / 1000).toFixed(1)}s</p>
              </button>
            ))}
        </ul>
      </BottomSheet>
    </div>
  )
}
