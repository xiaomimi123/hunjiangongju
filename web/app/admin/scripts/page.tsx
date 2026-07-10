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

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">文案库</h1>
      {err && <p className="pill pill-bad">{err}</p>}

      <section className="space-y-3">
        <p className="eyebrow">新建文案</p>
        <div className="card space-y-3 p-4">
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
        <div className="space-y-2.5">
          {list.map((s) => (
            <Link key={s.id} href={`/admin/scripts/${s.id}`}
              className="card flex items-center gap-3 p-4">
              <span className="flex-1 truncate font-medium">{s.title}</span>
              <span className="num shrink-0 text-xs text-ink3">{s._count.segments} 段</span>
              {s.status === 'published' ? (
                <span className="pill pill-ok shrink-0">已发布</span>
              ) : (
                <span className="chip shrink-0">草稿</span>
              )}
            </Link>
          ))}
          {list.length === 0 && <p className="card p-5 text-center text-sm text-ink3">暂无文案，先新建一个吧</p>}
        </div>
      </section>
    </div>
  )
}
