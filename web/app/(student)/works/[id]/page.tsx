'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'

// 生成流水线状态标签（本地维护，不用旧混剪的 lib/status.ts）
const GEN_LABELS: Record<string, string> = {
  GEN_CREATED: '已创建',
  SCRIPT_GENERATING: '文案生成中',
  IMAGE_GENERATING: '文生图中',
  TTS_GENERATING: '配音生成中',
  CAPTION_ALIGNING: '字幕对齐中',
  ASSET_READY: '素材就绪',
  VISUAL_RENDERING: '画面渲染中',
  RENDERING: '视频合成中',
  PREVIEW_PENDING: '待预览',
  QC_RUNNING: '质检中',
  QC_PASSED: '质检通过',
  QC_FAILED: '质检未通过',
  EXPORTED: '已完成',
  FAILED: '生成失败',
}
// 学员进度条主要节点（autoRender 一路串联）
const STEPS = ['文案', '文生图', '配音', '合成', '完成'] as const
function stepIndex(status: string): number {
  if (['GEN_CREATED', 'SCRIPT_GENERATING'].includes(status)) return 0
  if (status === 'IMAGE_GENERATING') return 1
  if (['TTS_GENERATING', 'CAPTION_ALIGNING', 'ASSET_READY'].includes(status)) return 2
  if (['VISUAL_RENDERING', 'RENDERING', 'PREVIEW_PENDING', 'QC_RUNNING', 'QC_PASSED'].includes(status)) return 3
  return 4 // EXPORTED / FAILED
}

function pill(status: string): { tone: string; label: string } {
  const tone = status === 'EXPORTED' || status === 'QC_PASSED' ? 'ok'
    : status === 'FAILED' || status === 'QC_FAILED' ? 'bad'
      : ['ASSET_READY', 'PREVIEW_PENDING'].includes(status) ? 'warn' : 'run'
  return { tone, label: GEN_LABELS[status] ?? status }
}

type Segment = { seqNo: number; scriptText: string; imageUrl: string | null }
type RenderTask = { id: string; status: string; videoUrl: string | null; subtitleUrl: string | null }
type GenTask = {
  id: string; subject: string; status: string
  framework: { id: string; name: string | null } | null
  segments: Segment[]
  renderTasks: RenderTask[]
}

const RENDER_TERMINAL = ['EXPORTED', 'QC_FAILED', 'FAILED']
// 学员 autoRender：genTask FAILED，或最新 render 进入终态即停轮询
function isSettled(t: GenTask): boolean {
  if (t.status === 'FAILED') return true
  const latest = t.renderTasks[0]
  return !!latest && RENDER_TERMINAL.includes(latest.status)
}

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<GenTask | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { const t = await api<GenTask>(`/api/generate/${id}`); setTask(t); return t }
    catch (e) { setErr((e as Error).message); return null }
  }, [id])

  useEffect(() => {
    let stopped = false
    load()
    const timer = setInterval(async () => {
      const t = await load()
      if (stopped) return
      if (!t || isSettled(t)) { stopped = true; clearInterval(timer) }
    }, 3000)
    return () => { stopped = true; clearInterval(timer) }
  }, [load])

  if (!task && err) {
    return (
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/works" className="text-sm text-flame">← 返回作品列表</Link>
      </div>
    )
  }
  if (!task) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>

  const rt = task.renderTasks[0]
  // 有 RenderTask 时展示合成阶段状态，否则展示生成阶段状态
  const displayStatus = rt ? rt.status : task.status
  const p = pill(displayStatus)
  const si = stepIndex(displayStatus)
  const working = !isSettled(task)
  const preview = task.renderTasks.find((r) => r.status === 'EXPORTED' && r.videoUrl)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{task.subject}</h1>
          {task.framework?.name && <p className="mt-1 truncate text-xs text-ink3">框架：{task.framework.name}</p>}
        </div>
        <span className={`pill pill-${p.tone} shrink-0`}>{p.label}</span>
      </div>
      {err && <p className="pill pill-bad">{err}</p>}

      {/* 步骤进度 */}
      <div className="card p-4">
        <ol className="flex items-center">
          {STEPS.map((s, i) => {
            const done = i < si || displayStatus === 'EXPORTED'
            const active = i === si && displayStatus !== 'EXPORTED'
            const failed = displayStatus === 'FAILED' && i === si
            return (
              <li key={s} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
                    failed ? 'bg-red-500 text-white'
                      : done ? 'grad text-white'
                        : active ? 'grad text-white' : 'bg-surface2 text-ink3'
                  }`}>{failed ? '!' : done ? '✓' : i + 1}</span>
                  <span className={`text-[11px] ${done || active ? 'text-ink2' : 'text-ink3'}`}>{s}</span>
                </div>
                {i < STEPS.length - 1 && <span className={`mx-1 h-0.5 flex-1 rounded ${i < si ? 'grad' : 'bg-line'}`} />}
              </li>
            )
          })}
        </ol>
        {working && <p className="mt-3 text-center text-xs text-ink3">正在自动生成，页面会实时刷新…</p>}
      </div>

      {preview && (
        <div className="space-y-3">
          <p className="eyebrow">成片预览</p>
          <div className="overflow-hidden rounded-3xl bg-black shadow-card">
            <video controls playsInline className="mx-auto max-h-[62vh] w-full bg-black object-contain" src={preview.videoUrl!} />
          </div>
          <a href={preview.videoUrl!} download className="btn-primary w-full">下载成片 MP4</a>
          {preview.subtitleUrl && <a href={preview.subtitleUrl} download className="btn-ghost w-full">下载字幕 SRT</a>}
        </div>
      )}

      {displayStatus === 'FAILED' && (
        <p className="card p-4 text-center text-sm text-ink3">生成失败了，请返回框架库重新发起。</p>
      )}

      {task.segments.length > 0 && (
        <section className="space-y-3">
          <p className="eyebrow">分段（{task.segments.length}）</p>
          <div className="grid grid-cols-2 gap-3">
            {task.segments.map((s) => (
              <div key={s.seqNo} className="card overflow-hidden">
                <div className="relative aspect-[3/4] bg-surface2">
                  {s.imageUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={s.imageUrl} alt={`第${s.seqNo}段`} className="h-full w-full object-cover" />
                    : <div className="grid h-full w-full place-items-center text-xs text-ink3">图片生成中…</div>}
                  <span className="num absolute left-2 top-2 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] text-white">#{s.seqNo}</span>
                </div>
                <p className="line-clamp-3 p-3 text-xs text-ink2">{s.scriptText}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
