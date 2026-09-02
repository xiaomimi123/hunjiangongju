'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import VideoCard from '@/components/VideoCard'

type OutputItem = { kind: 'text'; text: string } | { kind: 'image' | 'video' | 'file'; url: string }
type Status = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
type Run = {
  id: string; toolId: string; status: Status; errorMsg: string | null
  creditsCost: number; outputItems: OutputItem[] | null; createdAt: string; finishedAt: string | null
}
type Tool = { id: string; name: string }

const STATUS_LABEL: Record<Status, string> = {
  QUEUED: '排队中', RUNNING: '运行中', SUCCEEDED: '已完成', FAILED: '失败',
}
function tone(s: Status): 'ok' | 'bad' | 'run' {
  if (s === 'SUCCEEDED') return 'ok'
  if (s === 'FAILED') return 'bad'
  return 'run'
}
function isSettled(r: Run): boolean {
  return r.status === 'SUCCEEDED' || r.status === 'FAILED'
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }).catch(() => {})
      }}
      className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

export default function ToolRunResultPage() {
  const { id } = useParams<{ id: string }>()
  const [run, setRun] = useState<Run | null>(null)
  const [toolName, setToolName] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { const r = await api<Run>(`/api/tools/runs/${id}`); setRun(r); return r }
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

  useEffect(() => {
    if (!run) return
    api<{ tools: Tool[] }>('/api/tools').then((d) => {
      setToolName(d.tools.find((t) => t.id === run.toolId)?.name ?? null)
    }).catch(() => {})
  }, [run?.toolId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!run && err) {
    return (
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/tools/runs" className="text-sm text-flame">← 返回我的记录</Link>
      </div>
    )
  }
  if (!run) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>

  const items = run.outputItems ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">运行结果</h1>
          <p className="mt-1 text-xs text-ink3">消耗 {run.creditsCost} 积分</p>
        </div>
        <span className={`pill pill-${tone(run.status)} shrink-0`}>{STATUS_LABEL[run.status]}</span>
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      {!isSettled(run) && (
        <div className="card p-6 text-center">
          <p className="text-sm text-ink3">正在运行，页面会实时刷新…</p>
        </div>
      )}

      {run.status === 'FAILED' && (
        <div className="card space-y-1.5 p-4 text-center">
          <p className="text-sm text-ink2">{run.errorMsg || '运行失败'}</p>
          <p className="text-xs text-ink3">积分已退回</p>
        </div>
      )}

      {run.status === 'SUCCEEDED' && items.length === 0 && (
        <p className="card p-6 text-center text-sm text-ink3">本次运行没有可展示的结果</p>
      )}

      {run.status === 'SUCCEEDED' && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => {
            if (item.kind === 'video') {
              return (
                <VideoCard key={i} src={item.url} title={toolName ?? '生成结果'}
                  subtitle={new Date(run.createdAt).toLocaleString()}
                  footer={<a href={item.url} download className="btn-ghost mt-2 w-full">下载视频</a>} />
              )
            }
            return (
              <div key={i} className="card p-4">
                {item.kind === 'text' && (
                  <div className="flex items-start justify-between gap-3">
                    <p className="whitespace-pre-wrap text-sm text-ink2">{item.text}</p>
                    <CopyButton text={item.text} />
                  </div>
                )}
                {item.kind === 'image' && (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt="生成图片" className="w-full rounded-xl object-contain" />
                    <a href={item.url} download className="btn-ghost w-full">下载图片</a>
                  </div>
                )}
                {item.kind === 'file' && (
                  <a href={item.url} download className="btn-ghost w-full">下载文件</a>
                )}
              </div>
            )
          })}
        </div>
      )}

      {run.status === 'SUCCEEDED' && (
        <Link href={`/tools/${run.toolId}?from=${run.id}`} className="btn-ghost w-full">再跑一次</Link>
      )}

      <Link href="/tools/runs" className="block text-center text-sm text-flame">← 返回我的记录</Link>
    </div>
  )
}
