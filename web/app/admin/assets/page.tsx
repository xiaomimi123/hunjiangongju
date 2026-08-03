'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

type Asset = { id: string; kind: string; name: string; folder: string | null; fileUrl: string; createdAt: string }
type ListResp = { assets: Asset[]; folders: string[] }

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [filterFolder, setFilterFolder] = useState('')
  const [uploadFolder, setUploadFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')
  const [editFolder, setEditFolder] = useState('')

  const load = useCallback(async (folder: string) => {
    try {
      const q = folder ? `?folder=${encodeURIComponent(folder)}` : ''
      const r = await api<ListResp>(`/api/admin/assets${q}`)
      setAssets(r.assets)
      setFolders(r.folders)
    } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load(filterFolder) }, [load, filterFolder])

  async function upload(files: FileList) {
    setErr(''); setBusy(true)
    try {
      const fd = new FormData()
      Array.from(files).forEach((f) => fd.append('files', f))
      if (uploadFolder.trim()) fd.append('folder', uploadFolder.trim())
      await api('/api/admin/assets', { form: fd })
      await load(filterFolder)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  async function del(id: string) {
    if (!confirm('确认删除该素材？')) return
    setErr('')
    try { await api(`/api/admin/assets/${id}`, { method: 'DELETE' }); await load(filterFolder) }
    catch (e) { setErr((e as Error).message) }
  }

  function startEdit(a: Asset) {
    setEditingId(a.id); setEditName(a.name); setEditFolder(a.folder ?? '')
  }
  function cancelEdit() {
    setEditingId(''); setEditName(''); setEditFolder('')
  }
  async function saveEdit(id: string) {
    setErr('')
    try {
      await api(`/api/admin/assets/${id}`, { method: 'PATCH', body: { name: editName.trim(), folder: editFolder.trim() } })
      cancelEdit()
      await load(filterFolder)
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="素材库" subtitle="批量上传图片/视频素材，生成配图时可优先使用" />
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card space-y-3 p-4">
        <p className="eyebrow">批量上传</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">文件夹（可选，用于分类）</span>
            <input value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)} placeholder="如 旅行 / 治愈"
              className="field w-48" />
          </label>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm"
            multiple hidden
            onChange={(e) => { const fs = e.target.files; if (fs && fs.length) upload(fs); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary">
            {busy ? '上传中…' : '＋ 选择文件上传（可多选）'}
          </button>
        </div>
        <p className="text-xs text-ink3">支持图片 jpg / jpeg / png / webp，视频 mp4 / mov / webm。视频素材暂不参与生成，仅存放。</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="eyebrow">文件夹筛选</span>
        <select className="field w-48" value={filterFolder} onChange={(e) => setFilterFolder(e.target.value)}>
          <option value="">全部</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <section className="space-y-3">
        <p className="eyebrow">素材（{assets?.length ?? 0}）</p>
        {assets && assets.length === 0 && (
          <p className="card p-6 text-center text-sm text-ink3">还没有素材，先上传一批图片或视频。</p>
        )}
        {!assets && <p className="card p-6 text-center text-sm text-ink3">加载中…</p>}
        {assets && assets.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {assets.map((a) => (
              <div key={a.id} className="card overflow-hidden">
                {a.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.fileUrl} alt={a.name} className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 w-full flex-col items-center justify-center gap-1 bg-surface2 text-ink3">
                    <span className="text-xs">视频素材</span>
                    <span className="text-[11px]">暂不参与生成，仅存放</span>
                  </div>
                )}
                <div className="space-y-1.5 p-2.5">
                  {editingId === a.id ? (
                    <div className="space-y-1.5">
                      <input className="field w-full text-xs" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="名称" />
                      <input className="field w-full text-xs" value={editFolder} onChange={(e) => setEditFolder(e.target.value)} placeholder="文件夹（留空则移出）" />
                      <div className="flex justify-end gap-1.5">
                        <button onClick={cancelEdit} className="btn-ghost px-2 py-1 text-xs">取消</button>
                        <button onClick={() => saveEdit(a.id)} className="btn-primary px-2 py-1 text-xs">保存</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="truncate text-xs font-medium" title={a.name}>{a.name}</p>
                      <p className="truncate text-[11px] text-ink3">{a.folder || '未分类'}</p>
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => startEdit(a)} className="btn-ghost px-2 py-1 text-xs">编辑</button>
                        <button onClick={() => del(a.id)} className="btn-danger px-2 py-1 text-xs">删除</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
