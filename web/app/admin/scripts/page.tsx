'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'

type Script = { id: string; title: string; status: string; _count: { segments: number } }

export default function ScriptsPage() {
  const [list, setList] = useState<Script[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [err, setErr] = useState('')

  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    try { setList(await api<Script[]>('/api/scripts')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function create() {
    setErr('')
    try {
      await api('/api/scripts', { body: { title, content } })
      setTitle(''); setContent(''); load()
    } catch (e) { setErr((e as Error).message) }
  }

  async function togglePublish(s: Script) {
    setErr(''); setBusyId(s.id)
    try {
      await api(`/api/scripts/${s.id}`, { method: 'PATCH', body: { status: s.status === 'published' ? 'draft' : 'published' } })
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusyId('') }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">文案库</h1>
      {err && <p className="pill pill-bad">{err}</p>}

      <section className="space-y-3">
        <p className="eyebrow">新建文案</p>
        <div className="card max-w-xl space-y-3 p-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文案标题"
            className="field" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5}
            placeholder="文案内容（每个自然段一行，分段按换行拆分）"
            className="field" />
          <button onClick={create} disabled={!title.trim() || !content.trim()}
            className="btn-primary w-full">新建文案</button>
        </div>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">全部文案</p>
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
              {list.map((s) => (
                <tr key={s.id}>
                  <td className="max-w-xs truncate px-4 py-3 font-medium">{s.title}</td>
                  <td className="num px-4 py-3 text-right text-ink3">{s._count.segments}</td>
                  <td className="px-4 py-3">
                    {s.status === 'published' ? (
                      <span className="pill pill-ok">已发布</span>
                    ) : (
                      <span className="chip">草稿</span>
                    )}
                  </td>
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
              {list.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-ink3">暂无文案，先新建一个吧</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
