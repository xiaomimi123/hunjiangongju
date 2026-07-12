'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'

type Script = { id: string; title: string; status: string; _count: { segments: number } }

export default function ScriptsPage() {
  const [list, setList] = useState<Script[]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState('')

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try { setList(await api<Script[]>('/api/scripts')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function create() {
    setErr(''); setCreating(true)
    try { await api('/api/scripts', { body: { title, content } }); setTitle(''); setContent(''); setOpen(false); await load() }
    catch (e) { setErr((e as Error).message) } finally { setCreating(false) }
  }
  async function togglePublish(s: Script) {
    setErr(''); setBusyId(s.id)
    try { await api(`/api/scripts/${s.id}`, { method: 'PATCH', body: { status: s.status === 'published' ? 'draft' : 'published' } }); await load() }
    catch (e) { setErr((e as Error).message) } finally { setBusyId('') }
  }

  const shown = list.filter((s) => s.title.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div>
      <PageHeader title="文案库" subtitle="创建文案 → 自动分段 → 打标签 → 发布给学员">
        <button onClick={() => { setTitle(''); setContent(''); setOpen(true) }} className="btn-primary">＋ 新建文案</button>
      </PageHeader>
      {err && <p className="pill pill-bad mb-4">{err}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索文案标题" className="field max-w-xs" />
        <span className="ml-auto text-sm text-ink3">共 <span className="num text-ink">{shown.length}</span> 篇</span>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">标题</th>
              <th className="px-4 py-3 text-right font-medium">段数</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((s) => (
              <tr key={s.id} className="transition hover:bg-surface2/60">
                <td className="max-w-md truncate px-4 py-3 font-medium">{s.title}</td>
                <td className="num px-4 py-3 text-right text-ink3">{s._count.segments}</td>
                <td className="px-4 py-3">{s.status === 'published' ? <span className="pill pill-ok">已发布</span> : <span className="chip">草稿</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap text-sm">
                    {s.status === 'published' ? (
                      <button onClick={() => togglePublish(s)} disabled={busyId === s.id} className="text-ink2 hover:text-ink disabled:text-ink3">取消发布</button>
                    ) : s._count.segments === 0 ? (
                      <span className="text-ink3" title="发布前请先进入「查看」自动分段">需先分段</span>
                    ) : (
                      <button onClick={() => togglePublish(s)} disabled={busyId === s.id} className="font-medium text-flame disabled:text-ink3">发布</button>
                    )}
                    <Link href={`/admin/scripts/${s.id}`} className="btn-quiet px-2">查看</Link>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-ink3">{list.length === 0 ? '还没有文案，点右上角「新建文案」' : '没有匹配的文案'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => { if (!creating) setOpen(false) }} title="新建文案" wide>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文案标题" className="field" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={7} placeholder="文案内容（每个自然段一行，分段按换行拆分）" className="field" />
          <button onClick={create} disabled={creating || !title.trim() || !content.trim()} className="btn-primary w-full">{creating ? '创建中…' : '创建'}</button>
        </div>
      </Modal>
    </div>
  )
}
