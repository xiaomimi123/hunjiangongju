'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'
import { buildTree, type TagNode } from '@/lib/tagTree'

export default function TagsPage() {
  const [nodes, setNodes] = useState<TagNode[]>([])
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
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
    setName(''); setParentId(''); setOpen(false)
  })
  const rename = (id: string, old: string) => {
    const n = prompt('新名称', old)
    if (n && n !== old) run(() => api(`/api/tag-categories/${id}`, { method: 'PATCH', body: { name: n } }))
  }
  const del = (id: string) => { if (confirm('确认删除该节点？')) run(() => api(`/api/tag-categories/${id}`, { method: 'DELETE' })) }

  const tree = buildTree(nodes)
  return (
    <div>
      <PageHeader title="标签分类树" subtitle="维护标签，用于素材与文案分镜的自动匹配">
        <button onClick={() => { setName(''); setParentId(''); setOpen(true) }} className="btn-primary">＋ 新建节点</button>
      </PageHeader>
      {err && <p className="pill pill-bad mb-4">{err}</p>}

      <ul className="card divide-y divide-line">
        {tree.map((r) => (
          <li key={r.id}>
            <div className="flex items-center gap-2 px-4 py-3 md:px-6">
              <button onClick={() => setCollapsed((o) => ({ ...o, [r.id]: !o[r.id] }))} className="w-6 text-ink3">{collapsed[r.id] ? '▸' : '▾'}</button>
              <span className="flex-1 font-medium">{r.name}</span>
              <span className="num mr-2 text-xs text-ink3">{r.children.length} 个标签</span>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => rename(r.id, r.name)} className="btn-quiet px-2 text-sm">改名</button>
                <button onClick={() => del(r.id)} className="btn-quiet px-2 text-sm text-bad">删除</button>
              </div>
            </div>
            {!collapsed[r.id] && (
              <div className="flex flex-wrap gap-2 px-4 pb-3 pl-12 md:px-6 md:pl-14">
                {r.children.map((c) => (
                  <span key={c.id} className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2 py-1 pl-3 pr-1.5 text-sm">
                    {c.name}
                    <button onClick={() => rename(c.id, c.name)} className="rounded px-1 text-xs text-ink3 hover:text-ink" title="改名">✎</button>
                    <button onClick={() => del(c.id)} className="rounded px-1 text-xs text-ink3 hover:text-bad" title="删除">✕</button>
                  </span>
                ))}
                {r.children.length === 0 && <span className="text-sm text-ink3">该分类下暂无标签</span>}
              </div>
            )}
          </li>
        ))}
        {tree.length === 0 && <li className="px-4 py-12 text-center text-ink3">还没有标签分类</li>}
      </ul>

      <Modal open={open} onClose={() => setOpen(false)} title="新建节点">
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="节点名称" className="field" autoFocus />
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="field">
            <option value="">（作为顶级分类）</option>
            {tree.map((r) => <option key={r.id} value={r.id}>挂在「{r.name}」下</option>)}
          </select>
          <button onClick={add} disabled={!name.trim()} className="btn-primary w-full">创建</button>
        </div>
      </Modal>
    </div>
  )
}
