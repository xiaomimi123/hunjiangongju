'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import { buildTree, type TagNode } from '@/lib/tagTree'

export default function TagsPage() {
  const [nodes, setNodes] = useState<TagNode[]>([])
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { setNodes(await api<TagNode[]>('/api/tag-categories')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function run(fn: () => Promise<unknown>) {
    setErr('')
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) }
  }

  const add = () => run(async () => {
    await api('/api/tag-categories', { body: { name, parentId: parentId || undefined } })
    setName('')
  })
  const rename = (id: string, old: string) => {
    const n = prompt('新名称', old)
    if (n && n !== old) run(() => api(`/api/tag-categories/${id}`, { method: 'PATCH', body: { name: n } }))
  }
  const del = (id: string) => {
    if (confirm('确认删除该节点？')) run(() => api(`/api/tag-categories/${id}`, { method: 'DELETE' }))
  }

  const tree = buildTree(nodes)
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">标签分类树</h1>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      <div className="space-y-2 rounded-xl border bg-white p-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="节点名称"
          className="w-full rounded-lg border px-3 py-2" />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2">
          <option value="">（顶级分类）</option>
          {tree.map((r) => <option key={r.id} value={r.id}>挂在「{r.name}」下</option>)}
        </select>
        <button onClick={add} disabled={!name.trim()}
          className="w-full rounded-lg bg-blue-600 py-2 text-white disabled:opacity-40">新建节点</button>
      </div>
      <ul className="divide-y rounded-xl border bg-white">
        {tree.map((r) => (
          <li key={r.id}>
            <div className="flex items-center gap-2 px-3 py-3">
              <button onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))} className="w-6 text-gray-500">
                {open[r.id] ? '▾' : '▸'}
              </button>
              <span className="flex-1 font-medium">{r.name}</span>
              <button onClick={() => rename(r.id, r.name)} className="px-2 text-sm text-blue-600">改名</button>
              <button onClick={() => del(r.id)} className="px-2 text-sm text-red-500">删除</button>
            </div>
            {open[r.id] && r.children.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2 pl-12 pr-3">
                <span className="flex-1 text-sm">{c.name}</span>
                <button onClick={() => rename(c.id, c.name)} className="px-2 text-sm text-blue-600">改名</button>
                <button onClick={() => del(c.id)} className="px-2 text-sm text-red-500">删除</button>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
