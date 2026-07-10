'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import { flattenWithDepth, type TagNode } from '@/lib/tagTree'

export default function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [nodes, setNodes] = useState<TagNode[]>([])
  useEffect(() => { api<TagNode[]>('/api/tag-categories').then(setNodes) }, [])
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  return (
    <div className="max-h-56 space-y-1 overflow-auto rounded-lg border p-2">
      {flattenWithDepth(nodes).map((n) => (
        <label key={n.id} className="flex items-center gap-2 py-1" style={{ paddingLeft: n.depth * 20 }}>
          <input type="checkbox" checked={value.includes(n.id)} onChange={() => toggle(n.id)}
            className="h-5 w-5" disabled={n.depth === 0} />
          <span className={n.depth === 0 ? 'text-sm font-medium text-gray-500' : 'text-sm'}>{n.name}</span>
        </label>
      ))}
      <p className="text-xs text-gray-400">（勾选二级节点；一级为分类名）</p>
    </div>
  )
}
