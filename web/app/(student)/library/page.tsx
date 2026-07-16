'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'

type Work = {
  id: string
  subject: string
  framework: { name: string | null }
  videoUrl: string | null
  subtitleUrl: string | null
  createdAt: string
}

export default function LibraryPage() {
  const [works, setWorks] = useState<Work[]>([])
  const [err, setErr] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api<Work[]>('/api/library/works')
      .then(setWorks)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoaded(true))
  }, [])

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">成片库</h1>
      <p className="text-sm text-ink3">运营精选成片，点开即看，可下载复用</p>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="space-y-4">
        {works.map((w) => (
          <div key={w.id} className="card overflow-hidden p-0">
            <div className="bg-black">
              {w.videoUrl && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={w.videoUrl} controls playsInline preload="metadata"
                  className="mx-auto max-h-[62vh] w-full bg-black object-contain" />
              )}
            </div>
            <div className="space-y-3 p-4">
              <div>
                <p className="font-medium">{w.subject}</p>
                <p className="mt-0.5 text-xs text-ink3">
                  {w.framework.name ?? '框架'} · <span className="num">{new Date(w.createdAt).toLocaleDateString('zh-CN')}</span>
                </p>
              </div>
              <div className="flex gap-2.5 text-sm">
                {w.videoUrl && <a href={w.videoUrl} download className="btn-primary flex-1 text-center">下载 MP4</a>}
                {w.subtitleUrl && <a href={w.subtitleUrl} download className="btn-ghost flex-1 text-center">字幕 SRT</a>}
              </div>
            </div>
          </div>
        ))}
        {loaded && works.length === 0 && !err && (
          <div className="card grid place-items-center gap-1 py-14 text-center">
            <span className="text-3xl">🎞️</span>
            <p className="text-sm text-ink3">成片库还没有内容，敬请期待</p>
          </div>
        )}
      </div>
    </div>
  )
}
