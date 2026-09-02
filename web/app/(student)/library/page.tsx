'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'
import VideoCard from '@/components/VideoCard'

type Work = {
  id: string
  subject: string
  framework: { name: string | null }
  videoUrl: string | null
  subtitleUrl: string | null
  createdAt: string
}

type OutputItem = { kind: 'text'; text: string } | { kind: 'image' | 'video' | 'file'; url: string }
type Run = {
  id: string
  toolId: string
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  outputItems: OutputItem[] | null
  createdAt: string
}
type Tool = { id: string; name: string }

// 成片库合并展示的条目：书单成片（work）或工具产出（run）
type LibraryItem = {
  kind: 'work' | 'tool'
  id: string
  videoUrl: string | null
  title: string
  subtitle: string
  createdAt: string
  work?: Work
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'work', label: '书单成片' },
  { key: 'tool', label: '工具产出' },
] as const
type FilterKey = (typeof FILTERS)[number]['key']

export default function LibraryPage() {
  const router = useRouter()
  const [works, setWorks] = useState<Work[]>([])
  const [toolItems, setToolItems] = useState<LibraryItem[]>([])
  const [err, setErr] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')

  useEffect(() => {
    Promise.all([
      api<{ works: Work[]; nextCursor?: string }>('/api/library/works'),
      api<{ runs: Run[] }>('/api/tools/runs'),
      api<{ tools: Tool[] }>('/api/tools'),
    ])
      .then(([libRes, runsRes, toolsRes]) => {
        setWorks(libRes.works)
        setNextCursor(libRes.nextCursor ?? null)

        const toolNames: Record<string, string> = {}
        for (const t of toolsRes.tools) toolNames[t.id] = t.name

        const items: LibraryItem[] = []
        for (const r of runsRes.runs) {
          if (r.status !== 'SUCCEEDED') continue
          const videoItem = (r.outputItems ?? []).find((it): it is { kind: 'video'; url: string } => it.kind === 'video')
          if (!videoItem) continue
          items.push({
            kind: 'tool',
            id: r.id,
            videoUrl: videoItem.url,
            title: toolNames[r.toolId] ?? '已下架工具',
            subtitle: new Date(r.createdAt).toLocaleDateString('zh-CN'),
            createdAt: r.createdAt,
          })
        }
        setToolItems(items)
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoaded(true))
  }, [])

  const merged = useMemo<LibraryItem[]>(() => {
    const workItems: LibraryItem[] = works.map((w) => ({
      kind: 'work',
      id: w.id,
      videoUrl: w.videoUrl,
      title: w.subject,
      subtitle: `${w.framework.name ?? '框架'} · ${new Date(w.createdAt).toLocaleDateString('zh-CN')}`,
      createdAt: w.createdAt,
      work: w,
    }))
    const all = [...workItems, ...toolItems]
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    if (filter === 'all') return all
    return all.filter((it) => it.kind === filter)
  }, [works, toolItems, filter])

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">成片库</h1>
      <p className="text-sm text-ink3">运营精选成片 + 工具产出，点开即看，可下载复用</p>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              filter === f.key
                ? 'border-transparent bg-flame/[0.08] font-bold text-flame'
                : 'border-line bg-surface text-ink2'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {merged.map((item) =>
          item.kind === 'work' ? (
            <VideoCard
              key={`work-${item.id}`}
              src={item.videoUrl}
              title={item.title}
              subtitle={item.subtitle}
              trailing={
                item.work?.videoUrl ? (
                  <a href={`${item.work.videoUrl}?download=1`} download onClick={(e) => e.stopPropagation()} className="shrink-0 text-flame">
                    下载
                  </a>
                ) : undefined
              }
            />
          ) : (
            <VideoCard
              key={`tool-${item.id}`}
              src={item.videoUrl}
              title={item.title}
              subtitle={item.subtitle}
              onClick={() => router.push(`/tools/runs/${item.id}`)}
            />
          ),
        )}
      </div>

      {nextCursor && filter !== 'tool' && (
        <button className="btn-ghost w-full text-sm" disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true)
            try {
              const d = await api<{ works: Work[]; nextCursor?: string }>(`/api/library/works?cursor=${nextCursor}`)
              setWorks((prev) => [...prev, ...d.works])
              setNextCursor(d.nextCursor ?? null)
            } catch (e) { setErr((e as Error).message) }
            finally { setLoadingMore(false) }
          }}>
          {loadingMore ? '加载中…' : '加载更多'}
        </button>
      )}
      {loaded && merged.length === 0 && !err && (
        <div className="card grid place-items-center gap-1 py-14 text-center">
          <span className="text-3xl">🎞️</span>
          <p className="text-sm text-ink3">成片库还没有内容，敬请期待</p>
        </div>
      )}
    </div>
  )
}
