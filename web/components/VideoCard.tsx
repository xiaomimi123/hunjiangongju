'use client'
// 共享视频卡片：成片库 / 首页最近成片 / 运行结果页复用。
// 无 src 时展示渐变占位 + 低透明度播放钮；有 src 时先显示视频首帧（#t=0.1），
// 点击海报原地切换为带 controls 的可播放 video（不整页跳转）。
// 若传了 onClick，点击交给外部（比如跳转到运行详情页），不进入内嵌播放。
import { useEffect, useRef, useState } from 'react'

export type VideoCardProps = {
  src: string | null            // 视频 URL；null=无成片（进行中/失败）
  title: string
  subtitle?: string             // 副信息行左侧
  trailing?: React.ReactNode    // 副信息行右侧（下载链接等）
  badge?: { text: string; tone: 'ok' | 'run' | 'bad' | 'warn' }
  overlayTitle?: string         // 海报下方叠加标题（可选）
  posterClassName?: string      // 无视频时的渐变占位类
  onClick?: () => void
  footer?: React.ReactNode      // 后台版操作按钮排
}

const BADGE_TONE: Record<'ok' | 'run' | 'bad' | 'warn', string> = {
  ok: 'bg-[rgba(15,183,126,0.92)]',
  run: 'bg-[rgba(230,0,18,0.9)]',
  bad: 'bg-[rgba(245,51,79,0.92)]',
  // 待处理（如素材就绪待确认）：沿用 tailwind warn 色 #f59e0b 的 92% 不透明版
  warn: 'bg-[rgba(245,158,11,0.92)]',
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

// 内联 SVG 三角播放钮，禁用 emoji
function PlayIcon({ dim }: { dim?: boolean }) {
  return (
    <span
      className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/45 bg-white/20 backdrop-blur-sm ${dim ? 'opacity-40' : ''}`}
    >
      <svg viewBox="0 0 24 24" className="ml-0.5 h-[11px] w-[11px] fill-white stroke-none">
        <path d="M7 4.5v15l13-7.5z" />
      </svg>
    </span>
  )
}

export default function VideoCard({
  src, title, subtitle, trailing, badge, overlayTitle, posterClassName, onClick, footer,
}: VideoCardProps) {
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  // 首帧 <video> 视口懒挂载：卡片进视口前不挂 src（不发起首帧抽帧请求）。
  // 内嵌播放卡与跳转卡（有 onClick）都渲染这段首帧预览，懒挂载对两者同样生效——
  // 一页可能同时有近百张卡，不懒挂会并发近百个 range 请求抓视频头。
  const [inView, setInView] = useState(false)
  const posterRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!src) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const el = posterRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [src])

  const handlePosterClick = () => {
    if (onClick) { onClick(); return }
    if (src) setPlaying(true)
  }

  return (
    <div className="card overflow-hidden p-0">
      <div
        ref={posterRef}
        className={`relative flex aspect-[9/16] items-center justify-center overflow-hidden text-white ${
          (!src || !inView) && !playing ? (posterClassName ?? 'bg-gradient-to-br from-ink to-ink2') : 'bg-black'
        } ${onClick ? 'cursor-pointer' : ''}`}
        onClick={handlePosterClick}
      >
        {src && playing ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="h-full w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        ) : src ? (
          <>
            {/* 未进入视口前不挂 src，避免大量卡片同时发起首帧抽帧请求；
                进入视口（提前 200px）后才真正加载 */}
            {inView && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                src={`${src}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                className="absolute inset-0 h-full w-full object-cover"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d)) setDuration(d)
                }}
              />
            )}
            <PlayIcon />
            {duration != null && (
              <span className="absolute bottom-[7px] right-[7px] rounded-full bg-black/55 px-1.5 py-0.5 text-[0.62rem]">
                {formatDuration(duration)}
              </span>
            )}
          </>
        ) : (
          <PlayIcon dim />
        )}

        {badge && !playing && (
          <span className={`absolute left-[7px] top-[7px] rounded-full px-2 py-0.5 text-[0.62rem] font-semibold ${BADGE_TONE[badge.tone]}`}>
            {badge.text}
          </span>
        )}
        {overlayTitle && !playing && (
          <span className="absolute bottom-6 left-2 right-2 truncate text-[0.74rem] font-bold [text-shadow:0_1px_6px_rgba(0,0,0,0.5)]">
            {overlayTitle}
          </span>
        )}
      </div>
      <div className="space-y-0.5 pb-2.5 pl-2.5 pr-2.5 pt-2">
        <p className="truncate text-[0.76rem] font-bold">{title}</p>
        {(subtitle || trailing) && (
          <div className="flex items-center justify-between text-[0.64rem] text-ink3">
            <span className="truncate">{subtitle}</span>
            {trailing}
          </div>
        )}
        {footer}
      </div>
    </div>
  )
}
