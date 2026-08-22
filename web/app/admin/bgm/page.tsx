'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

type Bgm = { id: string; fileUrl: string; styleTag: string | null; durationMs: number | null; name: string | null; folder: string | null }

const UNGROUPED = '未分组'

export default function BgmPage() {
  const [list, setList] = useState<Bgm[]>([])
  const [styleTag, setStyleTag] = useState('')
  const [uploadFolder, setUploadFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')
  const [editFolder, setEditFolder] = useState('')

  const load = useCallback(async () => {
    try { setList(await api<Bgm[]>('/api/bgm')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function upload(files: FileList) {
    setErr(''); setBusy(true)
    try {
      const fd = new FormData()
      Array.from(files).forEach((f) => fd.append('files', f))
      fd.append('styleTag', styleTag.trim())
      if (uploadFolder.trim()) fd.append('folder', uploadFolder.trim())
      await api('/api/bgm', { form: fd })
      setStyleTag('')
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  async function del(id: string) {
    if (!confirm('确认删除这首 BGM？')) return
    setErr('')
    try { await api(`/api/bgm/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setErr((e as Error).message) }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  async function delSelected() {
    if (selected.size === 0) return
    if (!confirm(`确认删除选中的 ${selected.size} 首 BGM？被渲染任务引用的会自动跳过。`)) return
    setErr(''); setBusy(true)
    try {
      const r = await api<{ deleted: number; skipped: { name: string | null; reason: string }[] }>(
        '/api/bgm/batch-delete', { method: 'POST', body: { ids: Array.from(selected) } })
      if (r.skipped.length) setErr(`已删 ${r.deleted} 首；跳过 ${r.skipped.length} 首：${r.skipped.map((x) => `${x.name || '未命名'}（${x.reason}）`).join('、')}`)
      setSelected(new Set())
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  function startEdit(b: Bgm) {
    setEditingId(b.id); setEditName(b.name ?? ''); setEditFolder(b.folder ?? '')
  }
  function cancelEdit() {
    setEditingId(''); setEditName(''); setEditFolder('')
  }
  async function saveEdit(id: string) {
    setErr('')
    try {
      await api(`/api/bgm/${id}`, { method: 'PATCH', body: { name: editName.trim(), folder: editFolder.trim() } })
      cancelEdit()
      await load()
    } catch (e) { setErr((e as Error).message) }
  }

  const groups = new Map<string, Bgm[]>()
  for (const b of list) {
    const key = b.folder || UNGROUPED
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(b)
  }
  const groupNames = Array.from(groups.keys()).sort((a, b) => {
    if (a === UNGROUPED) return 1
    if (b === UNGROUPED) return -1
    return a.localeCompare(b)
  })

  return (
    <div className="space-y-5">
      <PageHeader title="BGM 曲库" subtitle="上传背景音乐（mp3，可多选批量），合成时供每个任务挑选" />
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card space-y-3 p-4">
        <p className="eyebrow">上传新 BGM（可多选）</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">风格标签（可选）</span>
            <input value={styleTag} onChange={(e) => setStyleTag(e.target.value)} placeholder="如 治愈 / 燃 / 悬疑"
              className="field w-48" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">文件夹（可选，用于分类）</span>
            <input value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)} placeholder="如 抒情 / 快节奏"
              className="field w-48" />
          </label>
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.m4a" multiple hidden
            onChange={(e) => { const fs = e.target.files; if (fs && fs.length) upload(fs); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary">
            {busy ? '上传中…' : '＋ 选择音频上传（可多选）'}
          </button>
        </div>
      </div>

      <section className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="eyebrow">曲库（{list.length}）</p>
          {list.length > 0 && (
            <>
              <button className="btn-ghost text-xs"
                onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((b) => b.id)))}>
                {selected.size === list.length ? '取消全选' : '全选'}
              </button>
              {selected.size > 0 && (
                <button className="btn-danger text-xs" disabled={busy} onClick={delSelected}>
                  删除选中（{selected.size}）
                </button>
              )}
            </>
          )}
          <span className="text-xs text-ink3">
            时长不用对齐：合成时自动从曲子开头（或框架里设置的起点）截取成片长度，60 秒的歌只会用到前 20 多秒。
          </span>
        </div>
        {list.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink3">曲库还是空的，先上传一首 mp3。</p>
        ) : (
          groupNames.map((g) => (
            <div key={g} className="space-y-2.5">
              <p className="text-xs font-medium text-ink3">{g}（{groups.get(g)!.length}）</p>
              <ul className="space-y-2.5">
                {groups.get(g)!.map((b) => (
                  <li key={b.id} className="card flex flex-wrap items-center gap-3 p-3">
                    <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                    <span className="pill">{b.styleTag || '未标注'}</span>
                    {editingId === b.id ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input className="field w-40 text-xs" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="名称" />
                        <input className="field w-40 text-xs" value={editFolder} onChange={(e) => setEditFolder(e.target.value)} placeholder="文件夹（留空则移出）" />
                        <button onClick={() => saveEdit(b.id)} className="btn-primary px-2 py-1 text-xs">保存</button>
                        <button onClick={cancelEdit} className="btn-ghost px-2 py-1 text-xs">取消</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(b)} className="text-sm font-medium hover:underline" title="点击改名/改文件夹">
                        {b.name || '（未命名）'}
                      </button>
                    )}
                    <audio controls src={b.fileUrl} className="h-9 min-w-[220px] flex-1" />
                    <button onClick={() => del(b.id)} className="btn-danger text-xs">删除</button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
