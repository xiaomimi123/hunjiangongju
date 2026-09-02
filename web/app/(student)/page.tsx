'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'
import { effStatus } from '@/lib/effStatus'
import VideoCard from '@/components/VideoCard'

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

// renderTasks 必须一起取：autoRender 任务的 status 停在 VISUAL_RENDERING，
// 真实进度在最新 RenderTask 上（见 lib/effStatus）
type Gen = {
  id: string; subject: string; status: string; createdAt: string
  framework: { name: string } | null
  renderTasks: { status: string; videoUrl: string | null }[]
}
type Tool = { id: string; name: string; description: string | null; priceCredits: number }
type Banner = { id: string; title: string; body: string; linkUrl: string | null }
type Wallet = { credits: number; qrUrl: string }

// 无成片时给 VideoCard 用的渐变占位，循环取样稿 p1~p6 色值
const POSTERS = [
  'bg-gradient-to-br from-[#2b2d42] to-[#8d99ae]',
  'bg-gradient-to-br from-[#5e3023] to-[#c08552]',
  'bg-gradient-to-br from-[#1d3557] to-[#457b9d]',
  'bg-gradient-to-br from-[#3a2d55] to-[#9b5de5]',
  'bg-gradient-to-br from-[#14342b] to-[#60935d]',
  'bg-gradient-to-br from-[#4a1c2e] to-[#b23a48]',
]

export default function HomePage() {
  const router = useRouter()
  const [recent, setRecent] = useState<Gen[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [banners, setBanners] = useState<Banner[]>([])
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [bannerIdx, setBannerIdx] = useState(0)

  useEffect(() => {
    api<{ tasks: Gen[] }>('/api/generate?limit=3').then((d) => setRecent(d.tasks)).catch(() => {})
    api<{ tools: Tool[] }>('/api/tools').then((d) => setTools(d.tools)).catch(() => {})
    api<{ banners: Banner[] }>('/api/banners').then((d) => setBanners(d.banners)).catch(() => {})
    api<Wallet>('/api/credits').then(setWallet).catch(() => {})
  }, [])

  // 多条公告才自动轮播：5s 切一张
  useEffect(() => {
    if (banners.length < 2) return
    const t = setInterval(() => setBannerIdx((i) => (i + 1) % banners.length), 5000)
    return () => clearInterval(t)
  }, [banners.length])

  // 工具宫格补格：凑到 4 的倍数、至少 4 格；没有工具时整块换成占位卡
  const fillCount = useMemo(() => (tools.length === 0 ? 0 : Math.ceil(tools.length / 4) * 4 - tools.length), [tools.length])

  const banner = banners[bannerIdx]
  const BannerInner = (
    <>
      <div className="min-w-0">
        <b className="block truncate text-[0.95rem]">{banner?.title}</b>
        <p className="mt-1 truncate text-[0.72rem] text-white/75">{banner?.body}</p>
      </div>
      {banners.length > 1 && (
        <div className="absolute bottom-[9px] right-3 flex gap-1">
          {banners.map((b, i) => (
            <i key={b.id} className={`h-[5px] rounded-full bg-white/40 ${i === bannerIdx ? 'w-3 bg-white' : 'w-[5px]'}`} />
          ))}
        </div>
      )}
    </>
  )

  return (
    <div className="space-y-7">
      {/* 深色头部：品牌 + 积分 + 公告轮播，吃满顶部安全区并向两侧出血到屏幕边缘 */}
      <div
        className="-mx-5 -mt-12 rounded-b-3xl px-[18px] pb-[22px] pt-12 text-white"
        style={{ backgroundImage: 'radial-gradient(140% 120% at 85% -20%, #4a1218 0%, #1a1214 55%)' }}
      >
        <div className="flex items-start justify-between">
          <div className="text-[1.35rem] font-extrabold tracking-wide">
            东方文澜
            <small className="ml-2 text-[0.68rem] font-normal tracking-normal text-white/55">电商带货创作台</small>
          </div>
          <div className="text-right">
            <b className="block text-[1.15rem] text-[#ffc53d]">{wallet?.credits ?? '--'}</b>
            <span className="block text-[0.66rem] text-white/55">剩余积分</span>
          </div>
        </div>

        {banner && (
          banner.linkUrl ? (
            banner.linkUrl.startsWith('/') && !banner.linkUrl.startsWith('//') ? (
              <Link
                href={banner.linkUrl}
                className="relative mt-4 flex h-24 items-center overflow-hidden rounded-2xl px-[18px] text-white"
                style={{ backgroundImage: 'linear-gradient(120deg,#7a1020,#2a0b10)' }}
              >
                {BannerInner}
              </Link>
            ) : (
              <a
                href={banner.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative mt-4 flex h-24 items-center overflow-hidden rounded-2xl px-[18px] text-white"
                style={{ backgroundImage: 'linear-gradient(120deg,#7a1020,#2a0b10)' }}
              >
                {BannerInner}
              </a>
            )
          ) : (
            <div
              className="relative mt-4 flex h-24 items-center overflow-hidden rounded-2xl px-[18px] text-white"
              style={{ backgroundImage: 'linear-gradient(120deg,#7a1020,#2a0b10)' }}
            >
              {BannerInner}
            </div>
          )
        )}
      </div>

      {/* 双 CTA */}
      <div className="grid grid-cols-[1.15fr_1fr] gap-3">
        <Link href="/templates" className="grad rounded-[20px] p-4 text-white shadow-lift">
          <b className="block text-[0.98rem] font-bold">挑框架做视频</b>
          <p className="mt-1 text-[0.7rem] text-white/80">选个框架 + 填选题 → 自动出成片</p>
        </Link>
        <Link href="/tools" className="card rounded-[20px] p-4">
          <b className="block text-[0.98rem] font-bold text-ink">智能工具</b>
          <p className="mt-1 text-[0.7rem] text-ink3">扣子工作流 · 按次计费</p>
        </Link>
      </div>

      {/* 工具宫格 */}
      <section>
        <p className="eyebrow">工 具</p>
        {tools.length === 0 ? (
          <div className="card grid place-items-center py-10 text-center">
            <p className="text-sm text-ink3">更多工具开发中</p>
          </div>
        ) : (
          <div className="mt-2.5 grid grid-cols-4 overflow-hidden rounded-[18px] bg-surface shadow-card">
            {tools.map((t, i) => (
              <Link
                key={t.id}
                href={`/tools/${t.id}`}
                className={`border-b border-paper px-1.5 pb-3.5 pt-4 text-center ${(i + 1) % 4 !== 0 ? 'border-r' : ''}`}
              >
                <div className="text-[1.5rem] font-bold text-flame" style={{ fontFamily: 'Georgia,"Songti SC",serif' }}>
                  {t.name.slice(0, 1)}
                </div>
                <p className="mt-1 truncate text-[0.68rem] text-ink2">{t.name}</p>
                <small className="text-[0.6rem] text-ink3">{t.priceCredits} 积分</small>
              </Link>
            ))}
            {Array.from({ length: fillCount }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className={`border-b border-paper px-1.5 pb-3.5 pt-4 text-center text-ink3 ${(tools.length + i + 1) % 4 !== 0 ? 'border-r' : ''}`}
              >
                <div className="text-[1.5rem] font-bold text-ink3" style={{ fontFamily: 'Georgia,"Songti SC",serif' }}>···</div>
                <p className="mt-1 text-[0.68rem]">敬请期待</p>
                <small className="text-[0.6rem]">&nbsp;</small>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 最近成片：横滑窄卡 */}
      {recent.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <p className="eyebrow">最 近 成 片</p>
            <Link href="/library" className="text-[0.72rem] text-ink3">
              查看全部 <span aria-hidden>›</span>
            </Link>
          </div>
          <div className="no-scrollbar mt-2.5 flex gap-3 overflow-x-auto pb-1.5">
            {recent.map((t, i) => {
              const st = effStatus(t)
              // 只有已完成的任务才有真实成片可取首帧；其余状态仍用渐变占位
              const src = st === 'EXPORTED' ? t.renderTasks[0]?.videoUrl ?? null : null
              return (
                <div key={t.id} className="w-32 flex-none">
                  <VideoCard
                    src={src}
                    title={t.subject}
                    subtitle={t.framework?.name ?? '框架'}
                    badge={{ text: GEN_LABELS[st] ?? st, tone: genTone(st) }}
                    posterClassName={POSTERS[i % POSTERS.length]}
                    onClick={() => router.push(`/works/${t.id}`)}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
