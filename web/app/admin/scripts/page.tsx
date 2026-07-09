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
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">文案库</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <div className="space-y-2 rounded-xl border bg-white p-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文案标题"
          className="w-full rounded-lg border px-3 py-2" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5}
          placeholder="文案内容（每个自然段一行，分段按换行拆分）"
          className="w-full rounded-lg border px-3 py-2" />
        <button onClick={create} disabled={!title.trim() || !content.trim()}
          className="w-full rounded-lg bg-blue-600 py-2 text-white disabled:opacity-40">新建文案</button>
      </div>
      <ul className="divide-y rounded-xl border bg-white">
        {list.map((s) => (
          <li key={s.id}>
            <Link href={`/admin/scripts/${s.id}`} className="flex items-center gap-2 px-3 py-3 active:bg-gray-50">
              <span className="flex-1">{s.title}</span>
              <span className="text-xs text-gray-400">{s._count.segments} 段</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${s.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {s.status === 'published' ? '已发布' : '草稿'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
