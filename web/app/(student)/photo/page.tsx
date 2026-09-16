'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, ApiError } from '@/lib/fetcher'

type Wallet = { credits: number; qrUrl: string }
type Mode = 'cover' | 'inner'

const SHOT_MODES: { id: string; label: string; note: string }[] = [
  { id: 'auto', label: '✦ 智能推荐', note: '按你封面的颜色与文字密度自动挑最合适的拍法' },
  { id: 'lap_front', label: '正面持书', note: '腿上阅读、封面正对镜头，适合浅色/文字多的封面' },
  { id: 'angled_pageblock', label: '斜持露书口', note: '轻斜露出书页厚度，适合深色/厚书' },
  { id: 'slightly_open', label: '封面微开', note: '自然阅读中的微微翻开，适合文学/小说' },
  { id: 'dark_fabric_close', label: '深色织物近景', note: '深色背景贴近拍，适合高饱和/插画封面' },
  { id: 'desk_props', label: '桌面道具', note: '书桌场景配少量道具，适合学习/职场书' },
]
const INNER_STYLES: { id: string; label: string; note: string; cls: string }[] = [
  { id: 'S01', label: '清透窗光', note: '胡桃木·暖光', cls: 'from-[#FBEED9] to-[#F7DFC0]' },
  { id: 'S02', label: '暗调', note: '深沉·侧光', cls: 'from-[#33373F] to-[#191B20]' },
]

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3l2-2.5h6L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.6" />
    </svg>
  )
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
      <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
    </svg>
  )
}

export default function PhotoGenPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('cover')
  const [shotMode, setShotMode] = useState('auto')
  const [style, setStyle] = useState('S01')
  const [count, setCount] = useState(2)
  const [rel, setRel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [err, setErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showRecharge, setShowRecharge] = useState(false)

  const [price, setPrice] = useState(1)
  const loadWallet = () => api<Wallet>('/api/credits').then(setWallet).catch(() => {})
  useEffect(() => {
    loadWallet()
    api<{ pricePerImage: number }>('/api/photo/config').then((c) => setPrice(c.pricePerImage)).catch(() => {})
  }, [])
  const totalPrice = Math.ceil(price * count) // 单价可为小数（如 0.5），总价向上取整成整数积分

  async function upload(file: File) {
    setErr(''); setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const r = await api<{ rel: string }>('/api/photo/upload', { form })
      setRel(r.rel)
    } catch (e) { setErr((e as Error).message) }
    finally { setUploading(false) }
  }

  async function submit() {
    if (!rel) { setErr('请先拍摄或上传一张书籍照片'); return }
    setErr(''); setSubmitting(true)
    try {
      const body = mode === 'cover'
        ? { mode, shotMode, count, inputImage: rel }
        : { mode, style, count, inputImage: rel }
      const run = await api<{ id: string }>('/api/photo/run', { body })
      router.push(`/photo/runs/${run.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_CREDITS') { setShowRecharge(true); loadWallet() }
      else setErr((e as Error).message)
      setSubmitting(false)
    }
  }

  const shotNote = SHOT_MODES.find((s) => s.id === shotMode)?.note ?? ''

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">AI 实拍生图</h1>
          <p className="mt-1 text-xs text-ink3">拍下你的书 · 生成真实感种草照</p>
        </div>
        {wallet && (
          <button onClick={() => setShowRecharge(true)} className="card shrink-0 px-3.5 py-2 text-right">
            <p className="text-xs text-ink3">剩余积分</p>
            <p className="num text-lg font-bold">{wallet.credits}</p>
          </button>
        )}
      </div>

      {/* 封面/内页 分段 */}
      <div className="card flex gap-1.5 p-1.5">
        {(['cover', 'inner'] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 rounded-xl py-2.5 text-sm transition ${mode === m ? 'bg-flame font-bold text-white' : 'text-ink3'}`}>
            {m === 'cover' ? '封面实拍' : '内页实拍'}
          </button>
        ))}
      </div>

      {/* 拍照/上传 */}
      {rel ? (
        <div className="card flex items-center gap-3 border-[1.5px] border-ok p-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${rel}`} alt="已拍摄" className="h-[68px] w-[52px] shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{mode === 'cover' ? '已拍摄封面' : '已拍摄内页'}</p>
            <p className="text-xs text-ok">✓ 可以生成</p>
          </div>
          <button onClick={() => setRel('')} className="shrink-0 text-xs font-medium text-flame">重拍</button>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-dashed border-line bg-white px-4 py-8 text-center transition active:scale-[0.99]">
          <CameraIcon className="h-9 w-9 text-ink3" />
          <span className="text-[15px] font-medium">{uploading ? '上传中…' : mode === 'cover' ? '拍摄书籍封面' : '拍摄一页内页'}</span>
          <span className="text-[11px] text-ink3">
            {mode === 'cover' ? '正对封面 · 光线充足 · 文字清晰完整' : '摊平书页 · 标题完整 · 避免阴影遮字'}
          </span>
          <span className="mt-1 rounded-full bg-surface2 px-3.5 py-1.5 text-xs text-ink3">拍照或从相册选择</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        </label>
      )}

      {/* 封面:拍法 / 内页:风格 */}
      {mode === 'cover' ? (
        <div className="space-y-2">
          <p className="eyebrow">选择拍法</p>
          <div className="flex flex-wrap gap-2">
            {SHOT_MODES.map((s) => (
              <button key={s.id} onClick={() => setShotMode(s.id)}
                className={`rounded-full px-3.5 py-2 text-[13px] transition ${shotMode === s.id
                  ? 'border-[1.5px] border-flame bg-flame/[0.07] font-bold text-flame'
                  : 'border-[1.5px] border-transparent bg-white text-ink2'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-ink3">{shotNote}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="eyebrow">选择风格</p>
          <div className="flex gap-2.5">
            {INNER_STYLES.map((s) => (
              <button key={s.id} onClick={() => setStyle(s.id)}
                className={`flex-1 overflow-hidden rounded-2xl pb-2.5 text-center transition ${style === s.id
                  ? 'border-[1.5px] border-flame bg-flame/[0.07]' : 'border-[1.5px] border-transparent bg-white'}`}>
                <span className={`mb-2 block h-[52px] bg-gradient-to-br ${s.cls}`} />
                <span className={`block text-[13px] ${style === s.id ? 'font-bold text-flame' : 'font-medium'}`}>{s.label}</span>
                <span className="block text-[10px] text-ink3">{s.note}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-ink3">取景不用选：系统自动识别左右页与标题位置，按规则贴近标题构图</p>
        </div>
      )}

      {/* 张数 */}
      <div className="flex items-center justify-between">
        <p className="eyebrow">生成张数</p>
        <div className="card flex items-center gap-4 rounded-full px-4 py-1.5">
          <button onClick={() => setCount((c) => Math.max(1, c - 1))} className="w-6 text-lg text-ink3">−</button>
          <span className="num min-w-[16px] text-center text-base font-bold">{count}</span>
          <button onClick={() => setCount((c) => Math.min(4, c + 1))} className="w-6 text-lg text-flame">＋</button>
        </div>
      </div>

      {err && <p className="pill pill-bad">{err}</p>}
      <button onClick={submit} disabled={submitting || uploading || !rel} className="btn-primary w-full">
        <BoltIcon />
        {submitting ? '提交中…' : rel ? `消耗 ${totalPrice} 积分 · 开始生成` : '先拍一张照片'}
      </button>
      <p className="text-center text-[0.66rem] text-ink3">生成约需 1-3 分钟 · 失败自动退回积分</p>
      <Link href="/photo/runs" className="block text-center text-sm text-flame">我的生图记录 →</Link>

      {showRecharge && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => setShowRecharge(false)}>
          <div className="card w-full max-w-sm space-y-4 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-display text-lg font-bold">{wallet && wallet.credits > 0 ? '积分充值' : '积分已用完'}</h3>
              <p className="mt-1 text-sm text-ink3">生成 {count} 张需 {totalPrice} 积分。扫码添加导师微信充值，到账后即可继续使用</p>
            </div>
            {wallet?.qrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={wallet.qrUrl} alt="导师微信二维码" className="mx-auto w-56 max-w-full rounded-xl" />
            ) : (
              <p className="rounded-xl bg-surface2 px-4 py-8 text-sm text-ink3">请联系你的导师充值</p>
            )}
            <button onClick={() => setShowRecharge(false)} className="btn-ghost w-full">知道了</button>
          </div>
        </div>
      )}
    </div>
  )
}
