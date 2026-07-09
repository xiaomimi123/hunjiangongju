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

  const load = useCallback(async () => setScript(await api<Script>(`/api/scripts/${id}`)), [id])
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

  if (!script) return <p>加载中…</p>
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{script.title}</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={doSegment} className="flex-1 rounded-lg border bg-white py-2">自动分段</button>
        <button onClick={togglePublish}
          className={`flex-1 rounded-lg py-2 text-white ${script.status === 'published' ? 'bg-gray-500' : 'bg-green-600'}`}>
          {script.status === 'published' ? '取消发布' : '发布'}
        </button>
      </div>
      <ul className="space-y-3">
        {script.segments.map((seg) => (
          <li key={seg.id} className="rounded-xl border bg-white p-3">
            <p className="text-sm"><span className="mr-2 text-gray-400">#{seg.seqNo}</span>{seg.text}</p>
            <div className="mt-2">
              {editing === seg.id ? (
                <TagPicker value={seg.tags.map((t) => t.tagId)}
                  onChange={(ids) => saveTags(seg.id, ids)} />
              ) : (
                <button onClick={() => setEditing(seg.id)} className="text-sm text-blue-600">
                  编辑标签（当前 {seg.tags.length} 个）
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {script.segments.length === 0 && <p className="text-sm text-gray-400">尚未分段，点击"自动分段"。</p>}
    </div>
  )
}
