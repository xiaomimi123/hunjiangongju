'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import { formatCredits } from '@/lib/credits'

type Status = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
type Run = {
  id: string; mode: string; shotMode: string | null; style: string | null; count: number
  status: Status; outputImages: { url: string; note?: string }[] | null
  errorMsg: string | null; inputImage: string; creditsCost: number; createdAt: string
}

const STATUS_LABEL: Record<Status, string> = { QUEUED: '排队中', RUNNING: '生成中', SUCCEEDED: '已完成', FAILED: '失败' }
const SHOT_LABEL: Record<string, string> = {
  auto: '智能推荐', lap_front: '正面持书', angled_pageblock: '斜持露书口',
  slightly_open: '封面微开', dark_fabric_close: '深色织物近景', desk_props: '桌面道具',
}
const STYLE_LABEL: Record<string, string> = { S01: '清透窗光', S02: '暗调' }

function tone(s: Status): 'ok' | 'bad' | 'run' {
  return s === 'SUCCEEDED' ? 'ok' : s === 'FAILED' ? 'bad' : 'run'
}
function isSettled(r: Run): boolean { return r.status === 'SUCCEEDED' || r.status === 'FAILED' }

export default function PhotoRunResultPage() {
  const { id } = useParams<{ id: string }>()
  const [run, setRun] = useState<Run | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { const r = await api<Run>(`/api/photo/runs/${id}`); setRun(r); return r }
    catch (e) { setErr((e as Error).message); return null }
  }, [id])

  useEffect(() => {
    let stopped = false
    load()
    const timer = setInterval(async () => {
      const r = await load()
      if (stopped) return
      if (!r || isSettled(r)) { stopped = true; clearInterval(timer) }
    }, 3000)
    return () => { stopped = true; clearInterval(timer) }
  }, [load])

  if (!run && err) {
    return (
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/photo/runs" className="text-sm text-flame">← 我的生图记录</Link>
      </div>
    )
  }
  if (!run) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>

  const sub = run.mode === 'cover'
    ? `封面实拍 · ${SHOT_LABEL[run.shotMode ?? 'auto'] ?? ''}`
    : `内页实拍 · ${STYLE_LABEL[run.style ?? 'S01'] ?? ''}`
  const images = run.outputImages ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">生成结果</h1>
          <p className="mt-1 text-xs text-ink3">{sub} · 消耗 {formatCredits(run.creditsCost)} 积分</p>
        </div>
        <span className={`pill pill-${tone(run.status)} shrink-0`}>{STATUS_LABEL[run.status]}</span>
      </div>

      {!isSettled(run) && (
        <div className="card space-y-2 p-8 text-center">
          <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-flame/15 border-t-flame" />
          <p className="text-sm font-medium">正在生成实拍照片…</p>
          <p className="text-xs leading-relaxed text-ink3">页面会实时刷新，无需等待<br />也可先去别处逛逛，结果保存在「生图记录」</p>
        </div>
      )}

      {run.status === 'FAILED' && (
        <div className="card space-y-1.5 p-5 text-center">
          <p className="text-sm text-ink2">{run.errorMsg || '生成失败'}</p>
          <p className="text-xs text-ink3">积分已退回</p>
        </div>
      )}

      {run.status === 'SUCCEEDED' && (
        <>
          <div className="card flex items-center gap-3 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${run.inputImage}`} alt="原图" className="h-12 w-9 shrink-0 rounded-md object-cover" />
            <p className="flex-1 text-xs text-ink3">你拍的原图</p>
            <Link href="/photo" className="shrink-0 text-xs font-medium text-flame">重拍</Link>
          </div>
          {run.errorMsg && <p className="pill pill-warn">{run.errorMsg}</p>}
          <div className="grid grid-cols-2 gap-3">
            {images.map((item, i) => (
              <div key={i} className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${item.url}`} alt={`生成结果 ${i + 1}`}
                  className="w-full rounded-2xl bg-surface2 object-cover" style={{ aspectRatio: run.mode === 'cover' ? '4/5' : '3/4' }} />
                <a href={`/api/files/${item.url}?download=1`} download className="btn-ghost w-full text-xs">保存图片</a>
              </div>
            ))}
          </div>
          <Link href="/photo" className="btn-primary w-full">再生成一组</Link>
        </>
      )}

      <Link href="/photo/runs" className="block text-center text-sm text-flame">← 我的生图记录</Link>
    </div>
  )
}
