'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import { flattenWithDepth, type TagNode } from '@/lib/tagTree'

export default function TagPicker({ value, onChange, nodes: nodesProp }: { value: string[]; onChange: (ids: string[]) => void; nodes?: TagNode[] }) {
  const [fetched, setFetched] = useState<TagNode[]>([])
  useEffect(() => { if (!nodesProp) api<TagNode[]>('/api/tag-categories').then(setFetched) }, [nodesProp])
  const nodes = nodesProp ?? fetched
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  return (
    <div className="max-h-56 overflow-auto rounded-2xl border border-line bg-surface2/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {flattenWithDepth(nodes).map((n) => {
          if (n.depth === 0) {
            return (
              <span key={n.id} className="eyebrow mt-2 basis-full first:mt-0">
                {n.name}
              </span>
            )
          }
          const on = value.includes(n.id)
          return (
            <button key={n.id} type="button" onClick={() => toggle(n.id)}
              className={
                on
                  ? 'inline-flex min-h-[40px] items-center rounded-full border border-flame bg-flame/5 px-3 text-sm font-medium text-flame transition'
                  : 'chip min-h-[40px] border border-transparent px-3 text-sm transition'
              }>
              {n.name}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-ink3">（勾选二级节点；一级为分类名）</p>
    </div>
  )
}
