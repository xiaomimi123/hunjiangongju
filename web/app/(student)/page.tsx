'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'

// 生成任务状态 → 中文标签 + 色调（成片流水线，区别于旧混剪状态）
const GEN_LABELS: Record<string, string> = {
  GEN_CREATED: '排队中', SCRIPT_GENERATING: '文案生成中', IMAGE_GENERATING: '配图生成中',
  TTS_GENERATING: '配音生成中', CAPTION_ALIGNING: '字幕对齐中', ASSET_READY: '素材就绪',
  VISUAL_RENDERING: '画面渲染中', RENDERING: '视频合成中', PREVIEW_PENDING: '待预览',
  QC_RUNNING: '质检中', QC_PASSED: '质检通过', QC_FAILED: '质检未通过',
  EXPORTED: '已完成', FAILED: '生成失败',
}
function genTone(s: string): 'ok' | 'bad' | 'run' {
  if (s === 'EXPORTED') return 'ok'
  if (s === 'FAILED' || s === 'QC_FAILED') return 'bad'
  return 'run'
}

type Gen = { id: string; subject: string; status: string; createdAt: string; framework: { name: string } | null }
type Work = { id: string; subject: string; framework: { name: string | null }; videoUrl: string | null; createdAt: string }
type Me = { nickname: string | null }

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [recent, setRecent] = useState<Gen[]>([])
  const [works, setWorks] = useState<Work[]>([])

  useEffect(() => {
    api<Me>('/api/auth/me').then(setMe).catch(() => {})
    api<Gen[]>('/api/generate').then((t) => setRecent(t.slice(0, 3))).catch(() => {})
    api<Work[]>('/api/library/works').then((w) => setWorks(w.slice(0, 4))).catch(() => {})
  }, [])

  return (
    <div className="space-y-7">
      <div>
        <p className="text-sm text-ink3">你好{me?.nickname ? `，${me.nickname}` : ''} 👋</p>
        <h1 className="mt-1 font-display text-[1.9rem] font-bold leading-tight tracking-tight">
          今天做一条<span className="grad-text">爆款</span>
        </h1>
      </div>

      <Link href="/templates" className="grad flex items-center justify-between rounded-3xl p-5 text-white shadow-lift">
        <div>
          <p className="text-lg font-bold">挑框架做视频</p>
          <p className="mt-0.5 text-sm text-white/85">选个框架 + 填选题 → 自动出成片</p>
        </div>
        <span className="text-2xl">⚡</span>
      </Link>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow">我的作品</p>
          {recent.length > 0 && <Link href="/works" className="text-sm text-flame">全部</Link>}
        </div>
        {recent.length > 0 ? (
          <div className="space-y-2.5">
            {recent.map((t) => (
              <Link key={t.id} href={`/works/${t.id}`} className="card flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.subject}</p>
                  <p className="mt-0.5 truncate text-xs text-ink3">{t.framework?.name ?? '框架'}</p>
                </div>
                <span className={`pill pill-${genTone(t.status)} shrink-0`}>{GEN_LABELS[t.status] ?? t.status}</span>
              </Link>
            ))}
          </div>
        ) : (
          <Link href="/templates" className="card grid place-items-center gap-1 py-10 text-center">
            <span className="text-3xl">🎬</span>
            <p className="text-sm text-ink3">还没有作品，去挑个框架开始吧</p>
          </Link>
        )}
      </section>

      {works.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="eyebrow">成片库精选</p>
            <Link href="/library" className="text-sm text-flame">更多</Link>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {works.map((w) => (
              <Link key={w.id} href="/library" className="card overflow-hidden p-0">
                <div className="aspect-[9/16] w-full bg-black">
                  {w.videoUrl && (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={`${w.videoUrl}#t=0.1`} preload="metadata" muted playsInline
                      className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-xs font-medium">{w.subject}</p>
                  <p className="mt-0.5 truncate text-[11px] text-ink3">{w.framework.name ?? '框架'}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
