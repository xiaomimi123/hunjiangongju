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
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">标签分类树</h1>
      {err && <p className="pill pill-bad">{err}</p>}
      <div className="card max-w-xl space-y-3 p-4">
        <p className="eyebrow">新建节点</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="节点名称"
          className="field" />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)}
          className="field">
          <option value="">（顶级分类）</option>
          {tree.map((r) => <option key={r.id} value={r.id}>挂在「{r.name}」下</option>)}
        </select>
        <button onClick={add} disabled={!name.trim()} className="btn-primary w-full">新建节点</button>
      </div>
      <ul className="card divide-y divide-line">
        {tree.map((r) => (
          <li key={r.id}>
            <div className="flex items-center gap-2 px-4 py-3 md:px-6">
              <button onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))} className="w-6 text-ink3">
                {open[r.id] ? '▾' : '▸'}
              </button>
              <span className="flex-1 font-medium">{r.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => rename(r.id, r.name)} className="btn-quiet px-2 text-sm">改名</button>
                <button onClick={() => del(r.id)} className="btn-quiet px-2 text-sm text-bad">删除</button>
              </div>
            </div>
            {open[r.id] && r.children.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2 pl-12 pr-4 md:pr-6">
                <span className="flex-1 text-sm text-ink2">{c.name}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => rename(c.id, c.name)} className="btn-quiet px-2 text-sm">改名</button>
                  <button onClick={() => del(c.id)} className="btn-quiet px-2 text-sm text-bad">删除</button>
                </div>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
