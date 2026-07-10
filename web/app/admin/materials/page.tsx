'use client'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import TagPicker from '@/components/TagPicker'

type Material = {
  id: string; fileUrl: string; thumbnailUrl: string | null
  durationMs: number | null; tags: { tagId: string }[]
}

function MaterialsInner() {
  const returnTaskId = useSearchParams().get('returnTaskId')
  const [list, setList] = useState<Material[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [progress, setProgress] = useState(-1)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { setList(await api<Material[]>(`/api/materials${filter ? `?tagId=${filter}` : ''}`)) }
    catch (e) { setErr((e as Error).message) }
  }, [filter])
  useEffect(() => { load() }, [load])

  function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) return setErr('请选择视频文件')
    if (tagIds.length === 0) return setErr('请至少勾选一个标签')
    setErr('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('tagIds', JSON.stringify(tagIds))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/materials')
    xhr.upload.onprogress = (e) => setProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      setProgress(-1)
      if (xhr.status >= 400) return setErr(JSON.parse(xhr.responseText).error ?? '上传失败')
      if (fileRef.current) fileRef.current.value = ''
      setTagIds([])
      load()
    }
    xhr.onerror = () => { setProgress(-1); setErr('网络错误') }
    xhr.send(fd)
  }

  const del = async (id: string) => {
    if (!confirm('确认删除素材？')) return
    try { await api(`/api/materials/${id}`, { method: 'DELETE' }); load() } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">素材库</h1>
      {returnTaskId && (
        <div className="card space-y-3 border-l-4 border-l-flame p-4">
          <p className="text-sm text-ink2">正在为任务补充素材，上传完成后点此返回任务详情</p>
          <Link href={`/admin/tasks/${returnTaskId}`} className="btn-primary w-full">返回任务详情 →</Link>
        </div>
      )}
      {err && <p className="pill pill-bad">{err}</p>}
      <div className="card space-y-3 p-4">
        <p className="eyebrow">上传素材</p>
        <input ref={fileRef} type="file" accept="video/*" className="field text-sm" />
        <TagPicker value={tagIds} onChange={setTagIds} />
        {progress >= 0 ? (
          <div className="h-2 overflow-hidden rounded-full bg-surface2">
            <div className="grad h-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        ) : (
          <button onClick={upload} className="btn-primary w-full">上传素材</button>
        )}
      </div>
      <FilterBar value={filter} onChange={setFilter} />
      <ul className="grid grid-cols-2 gap-3">
        {list.map((m) => (
          <li key={m.id} className="card overflow-hidden">
            {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />}
            <div className="space-y-2 p-3">
              <span className="chip">
                <span className="chip-dot bg-ink3" />
                <span className="num">{((m.durationMs ?? 0) / 1000).toFixed(1)}</span>s · <span className="num">{m.tags.length}</span>标签
              </span>
              <button onClick={() => del(m.id)} className="btn-danger w-full text-xs">删除</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilterBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [nodes, setNodes] = useState<{ id: string; name: string; parentId: string | null }[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    api<typeof nodes>('/api/tag-categories').then(setNodes).catch((e) => setErr((e as Error).message))
  }, [])
  return (
    <div className="space-y-1">
      {err && <p className="pill pill-bad">{err}</p>}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field">
        <option value="">全部标签</option>
        {nodes.filter((n) => n.parentId).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>
    </div>
  )
}

export default function MaterialsPage() {
  return <Suspense><MaterialsInner /></Suspense>
}
