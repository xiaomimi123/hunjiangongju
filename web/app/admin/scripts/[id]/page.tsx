'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/fetcher'
import TagPicker from '@/components/TagPicker'

type Segment = { id: string; seqNo: number; text: string; tags: { tagId: string }[] }
type Script = { id: string; title: string; content: string; status: string; segments: Segment[] }

export default function ScriptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [script, setScript] = useState<Script | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { setScript(await api<Script>(`/api/scripts/${id}`)) }
    catch (e) { setErr((e as Error).message) }
  }, [id])
  useEffect(() => { load() }, [load])

  async function run(fn: () => Promise<unknown>) {
    setErr('')
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) }
  }
  const doSegment = () => run(() => api(`/api/scripts/${id}/segment`, { method: 'POST' }))
  const togglePublish = () => run(() =>
    api(`/api/scripts/${id}`, { method: 'PATCH', body: { status: script?.status === 'published' ? 'draft' : 'published' } }))
  const saveTags = (segId: string, tagIds: string[]) =>
    run(() => api(`/api/scripts/segments/${segId}/tags`, { method: 'PATCH', body: { tagIds } }))

  if (!script && err) return <p className="pill pill-bad">{err}</p>
  if (!script) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="truncate font-display text-xl font-bold tracking-tight">{script.title}</h1>
      {err && <p className="pill pill-bad">{err}</p>}
      <div className="flex gap-2.5">
        <button onClick={doSegment} className="btn-ghost flex-1">自动分段</button>
        <button onClick={togglePublish}
          className={script.status === 'published' ? 'btn-ghost flex-1' : 'btn-primary flex-1'}>
          {script.status === 'published' ? '取消发布' : '发布'}
        </button>
      </div>
      <section className="space-y-3">
        <p className="eyebrow">分镜段</p>
        <ul className="space-y-2.5">
          {script.segments.map((seg) => (
            <li key={seg.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface2 text-xs font-semibold text-ink2">
                  {seg.seqNo}
                </span>
                <p className="flex-1 text-sm">{seg.text}</p>
              </div>
              <div className="mt-3">
                {editing === seg.id ? (
                  <TagPicker value={seg.tags.map((t) => t.tagId)}
                    onChange={(ids) => saveTags(seg.id, ids)} />
                ) : (
                  <button onClick={() => setEditing(seg.id)} className="btn-quiet px-0 text-sm">
                    编辑标签（当前 <span className="num">{seg.tags.length}</span> 个）
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {script.segments.length === 0 && <p className="card p-5 text-center text-sm text-ink3">尚未分段，点击"自动分段"。</p>}
      </section>
    </div>
  )
}
