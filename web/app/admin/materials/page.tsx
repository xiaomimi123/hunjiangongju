'use client'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import TagPicker from '@/components/TagPicker'
import type { TagNode } from '@/lib/tagTree'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'

type Material = {
  id: string; kind: string; fileUrl: string; thumbnailUrl: string | null
  durationMs: number | null; tags: { tagId: string }[]
}
type QStatus = 'pending' | 'uploading' | 'done' | 'error'
type QItem = { key: string; file: File; tags: string[]; status: QStatus; progress: number; error?: string }

let seq = 0

function MaterialsInner() {
  const returnTaskId = useSearchParams().get('returnTaskId')
  const [list, setList] = useState<Material[]>([])
  const [nodes, setNodes] = useState<TagNode[]>([])
  const [filter, setFilter] = useState('')                          // 按标签筛选
  const [kindFilter, setKindFilter] = useState<'all' | 'video' | 'image'>('all')
  const [editId, setEditId] = useState<string | null>(null)          // 网格里正在改标签的素材
  const [preview, setPreview] = useState<Material | null>(null)      // 点击预览
  const [err, setErr] = useState('')

  // 上传弹层状态
  const [uploadOpen, setUploadOpen] = useState(false)
  const [defaultTags, setDefaultTags] = useState<string[]>([])
  const [queue, setQueue] = useState<QItem[]>([])
  const [openTagKey, setOpenTagKey] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { setList(await api<Material[]>(`/api/materials${filter ? `?tagId=${filter}` : ''}`)) }
    catch (e) { setErr((e as Error).message) }
  }, [filter])
  useEffect(() => { load() }, [load])
  useEffect(() => { api<TagNode[]>('/api/tag-categories').then(setNodes).catch(() => {}) }, [])
  useEffect(() => { if (returnTaskId) setUploadOpen(true) }, [returnTaskId])

  const tagName = (id: string) => nodes.find((n) => n.id === id)?.name ?? id
  const setQ = (key: string, patch: Partial<QItem>) =>
    setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const shown = list.filter((m) => kindFilter === 'all' || m.kind === kindFilter)

  function addFiles(files: FileList | File[]) {
    const ok = Array.from(files).filter((f) =>
      f.type.startsWith('video/') || f.type.startsWith('image/') || /\.(mp4|mov|m4v|webm|avi|mkv|jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name))
    if (ok.length === 0) { setErr('请选择视频或图片文件'); return }
    setErr('')
    setQueue((q) => [...q, ...ok.map((file) => ({ key: `q${seq++}`, file, tags: [...defaultTags], status: 'pending' as QStatus, progress: 0 }))])
  }

  function uploadOne(item: QItem): Promise<void> {
    return new Promise((resolve) => {
      const fd = new FormData()
      fd.append('file', item.file)
      fd.append('tagIds', JSON.stringify(item.tags))
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/materials')
      setQ(item.key, { status: 'uploading', progress: 0, error: undefined })
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setQ(item.key, { progress: Math.round((e.loaded / e.total) * 100) }) }
      xhr.onload = () => {
        if (xhr.status >= 400) { let msg = '上传失败'; try { msg = JSON.parse(xhr.responseText).error ?? msg } catch {}; setQ(item.key, { status: 'error', error: msg }) }
        else setQ(item.key, { status: 'done', progress: 100 })
        resolve()
      }
      xhr.onerror = () => { setQ(item.key, { status: 'error', error: '网络错误' }); resolve() }
      xhr.send(fd)
    })
  }

  async function uploadAll() {
    const pend = queue.filter((it) => it.status === 'pending' || it.status === 'error')
    if (pend.length === 0) return
    if (pend.some((it) => it.tags.length === 0)) { setErr('每个文件至少勾选一个标签'); return }
    setErr(''); setUploading(true); setOpenTagKey(null)
    let i = 0
    const worker = async () => { while (i < pend.length) { const it = pend[i++]; await uploadOne(it) } }
    await Promise.all([worker(), worker(), worker()])
    setUploading(false)
    await load()
    setQueue((q) => q.filter((it) => it.status !== 'done'))
  }

  async function saveMaterialTags(id: string, tagIds: string[]) {
    setErr('')
    try { await api(`/api/materials/${id}`, { method: 'PATCH', body: { tagIds } }); setEditId(null); await load() }
    catch (e) { setErr((e as Error).message) }
  }
  const del = async (id: string) => {
    if (!confirm('确认删除素材？')) return
    try { await api(`/api/materials/${id}`, { method: 'DELETE' }); load() } catch (e) { setErr((e as Error).message) }
  }

  const pendingCount = queue.filter((it) => it.status === 'pending' || it.status === 'error').length
  const kinds: { k: 'all' | 'video' | 'image'; label: string }[] = [{ k: 'all', label: '全部' }, { k: 'video', label: '视频' }, { k: 'image', label: '图片' }]

  return (
    <div>
      <PageHeader title="素材库" subtitle="上传视频 / 图片并打标签，供混剪自动匹配">
        <button onClick={() => setUploadOpen(true)} className="btn-primary">＋ 上传素材</button>
      </PageHeader>
      {err && <p className="pill pill-bad mb-4">{err}</p>}

      {/* 工具条：标签筛选 + 类型筛选 + 计数 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="field max-w-[200px]">
          <option value="">全部标签</option>
          {nodes.filter((n) => n.parentId).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <div className="flex gap-1 rounded-full bg-surface2 p-1 text-sm">
          {kinds.map((x) => (
            <button key={x.k} onClick={() => setKindFilter(x.k)}
              className={`rounded-full px-3 py-1.5 font-medium transition ${kindFilter === x.k ? 'bg-surface text-ink shadow-card' : 'text-ink3'}`}>{x.label}</button>
          ))}
        </div>
        <span className="ml-auto text-sm text-ink3">共 <span className="num text-ink">{shown.length}</span> 条</span>
      </div>

      {/* 素材网格：填满宽度、更密 */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {shown.map((m) => (
          <li key={m.id} className="card overflow-hidden">
            <button onClick={() => setPreview(m)} className="group relative block aspect-video w-full overflow-hidden bg-surface2">
              <span className="pointer-events-none absolute inset-0 grid place-items-center text-2xl text-ink3">{m.kind === 'image' ? '🖼️' : '🎬'}</span>
              {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />}
              <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">{m.kind === 'image' ? '图片' : '视频'}</span>
              {m.kind !== 'image' && <span className="num absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white">{((m.durationMs ?? 0) / 1000).toFixed(1)}s</span>}
              <span className="absolute inset-0 grid place-items-center bg-black/0 text-2xl text-white/0 transition group-hover:bg-black/25 group-hover:text-white/90">▶</span>
            </button>
            <div className="space-y-2 p-2.5">
              <div className="flex flex-wrap gap-1">
                {m.tags.slice(0, 4).map((t) => <span key={t.tagId} className="rounded bg-surface2 px-1.5 py-0.5 text-[11px] text-ink2">{tagName(t.tagId)}</span>)}
                {m.tags.length === 0 && <span className="text-[11px] text-bad">无标签</span>}
                {m.tags.length > 4 && <span className="text-[11px] text-ink3">+{m.tags.length - 4}</span>}
              </div>
              {editId === m.id ? (
                <TagPicker value={m.tags.map((t) => t.tagId)} onChange={(ids) => saveMaterialTags(m.id, ids)} nodes={nodes} />
              ) : (
                <div className="flex gap-1.5">
                  <button onClick={() => setEditId(m.id)} className="btn-quiet flex-1 text-xs">编辑标签</button>
                  <button onClick={() => del(m.id)} className="text-xs text-bad hover:underline">删除</button>
                </div>
              )}
            </div>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="col-span-full grid place-items-center gap-2 rounded-2xl border border-dashed border-line py-16 text-center">
            <span className="text-3xl">📁</span>
            <p className="text-sm text-ink3">{list.length === 0 ? '素材库还是空的' : '该筛选下没有素材'}</p>
            <button onClick={() => setUploadOpen(true)} className="btn-primary mt-1">＋ 上传素材</button>
          </li>
        )}
      </ul>

      {/* 上传弹层 */}
      <Modal open={uploadOpen} onClose={() => { if (!uploading) setUploadOpen(false) }} title="上传素材" wide>
        {returnTaskId && (
          <div className="mb-3 rounded-xl border-l-4 border-l-flame bg-surface2 p-3 text-sm text-ink2">
            正在为任务补充素材，传完后 <Link href={`/admin/tasks/${returnTaskId}`} className="font-medium text-flame">返回任务详情 →</Link>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <p className="eyebrow mb-2">① 默认标签（新拖入的文件自动套用，可逐个再改）</p>
            <TagPicker value={defaultTags} onChange={setDefaultTags} nodes={nodes} />
          </div>
          <div>
            <p className="eyebrow mb-2">② 添加素材（视频或图片，可一次多选 / 拖拽）</p>
            <input ref={fileRef} type="file" accept="video/*,image/*" multiple hidden
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
            <div onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
              className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition ${dragOver ? 'border-flame bg-flame/5' : 'border-line bg-surface2/50 hover:border-flame/50'}`}>
              <p className="text-2xl">🎬</p>
              <p className="mt-1 text-sm text-ink2">把视频 / 图片拖到这里，或<span className="font-medium text-flame">点击选择多个</span></p>
              <p className="mt-0.5 text-xs text-ink3">视频 mp4 / mov / webm，图片 jpg / png / webp</p>
            </div>
          </div>
          {queue.length > 0 && (
            <div>
              <p className="eyebrow mb-2">③ 待上传（<span className="num">{queue.length}</span>）</p>
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {queue.map((it) => (
                  <li key={it.key} className="rounded-xl border border-line bg-surface p-2.5">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm">{it.file.name}</span>
                      <span className="num shrink-0 text-xs text-ink3">{(it.file.size / 1048576).toFixed(1)}MB</span>
                      {it.status === 'done' ? <span className="pill pill-ok shrink-0">完成</span>
                        : it.status === 'error' ? <span className="pill pill-bad shrink-0">{it.error ?? '失败'}</span>
                        : it.status === 'uploading' ? <span className="num shrink-0 text-xs text-flame">{it.progress}%</span>
                        : <button onClick={() => setQueue((q) => q.filter((x) => x.key !== it.key))} className="shrink-0 text-ink3 hover:text-bad" aria-label="移除">✕</button>}
                    </div>
                    {it.status === 'uploading' && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2"><div className="grad h-full transition-all" style={{ width: `${it.progress}%` }} /></div>}
                    {(it.status === 'pending' || it.status === 'error') && (
                      <div className="mt-2">
                        <button onClick={() => setOpenTagKey(openTagKey === it.key ? null : it.key)} className={`text-xs ${it.tags.length ? 'text-ink2' : 'text-bad'} hover:text-ink`}>
                          标签：{it.tags.length ? it.tags.map(tagName).join('、') : '未设置'} ▾
                        </button>
                        {openTagKey === it.key && <div className="mt-2"><TagPicker value={it.tags} onChange={(ids) => setQ(it.key, { tags: ids })} nodes={nodes} /></div>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2.5">
            <button onClick={uploadAll} disabled={uploading || pendingCount === 0} className="btn-primary flex-1">{uploading ? '上传中…' : `开始上传（${pendingCount}）`}</button>
            {queue.length > 0 && <button onClick={() => setQueue([])} disabled={uploading} className="btn-ghost shrink-0">清空</button>}
            <button onClick={() => { if (!uploading) setUploadOpen(false) }} className="btn-ghost shrink-0">完成</button>
          </div>
        </div>
      </Modal>

      {/* 预览弹层 */}
      {preview && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4" onClick={() => setPreview(null)}>
          <div className="max-h-[85vh] max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {preview.kind === 'image'
              ? <img src={preview.fileUrl} alt="" className="max-h-[85vh] w-auto rounded-2xl" />
              : <video src={preview.fileUrl} controls autoPlay playsInline className="max-h-[85vh] w-auto rounded-2xl bg-black" />}
          </div>
        </div>
      )}
    </div>
  )
}

export default function MaterialsPage() {
  return <Suspense><MaterialsInner /></Suspense>
}
