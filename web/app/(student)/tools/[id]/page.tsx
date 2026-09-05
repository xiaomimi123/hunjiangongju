'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api, ApiError } from '@/lib/fetcher'
import VideoCard from '@/components/VideoCard'

type InputType = 'text' | 'textarea' | 'select' | 'image'
type ToolInput = { name: string; label: string; type: InputType; options?: string[]; placeholder?: string; required: boolean }
type Tool = {
  id: string; name: string; description: string | null; priceCredits: number; inputs: ToolInput[]
  demoVideoUrl: string | null; tutorialVideoUrl: string | null
}
type Wallet = { credits: number; qrUrl: string }
// 「再跑一次」预填只需要 id 和 inputs——从运行记录列表接口里挑一条
type PrevRun = { id: string; inputs: unknown }

// 内联 SVG 图标：禁 emoji，照样稿 #i-img / #i-bolt
function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5 text-ink3" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 18l5-5 3 3 4-4 4 4" />
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

export default function ToolFormPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromRunId = searchParams.get('from')

  const [tool, setTool] = useState<Tool | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({})
  const [prefillNote, setPrefillNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showRecharge, setShowRecharge] = useState(false)

  const loadWallet = () => api<Wallet>('/api/credits').then(setWallet).catch(() => {})

  useEffect(() => {
    // /api/tools 只返回列表，没有单条详情接口，从列表里按 id 找
    api<{ tools: Tool[] }>('/api/tools').then((d) => {
      const t = d.tools.find((x) => x.id === id)
      if (!t) { setErr('工具不存在或已下架'); return }
      setTool(t)
    }).catch((e) => setErr((e as Error).message))
    loadWallet()
  }, [id])

  // 「再跑一次」预填：GET /api/tools/runs/[id] 出于隐私考虑不下发 inputs（见其路由注释），
  // 改从运行记录列表接口（本就带 inputs，供成片库拼摘要用）里按 id 挑这一条。只预填文本类
  // 字段——图片字段的上传路径已是历史文件，直接搬进新一轮提交没意义，提示用户重新上传。
  useEffect(() => {
    if (!tool || !fromRunId) return
    api<{ runs: PrevRun[] }>('/api/tools/runs').then((d) => {
      const prev = d.runs.find((r) => r.id === fromRunId)
      if (!prev || !prev.inputs || typeof prev.inputs !== 'object') return
      const inputsObj = prev.inputs as Record<string, unknown>
      const next: Record<string, string> = {}
      let hasImageField = false
      for (const input of tool.inputs) {
        if (input.type === 'image') { hasImageField = true; continue }
        const v = inputsObj[input.name]
        if (typeof v === 'string' && v) next[input.name] = v
      }
      if (Object.keys(next).length > 0) {
        setValues((cur) => ({ ...next, ...cur }))
        setPrefillNote(hasImageField ? '已带入上次的文本填写，图片需重新上传' : '已带入上次的文本填写')
      }
    }).catch(() => {})
  }, [tool, fromRunId])

  function setValue(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }))
    setFieldErr((prev) => (prev[name] ? { ...prev, [name]: '' } : prev))
  }

  async function uploadImage(name: string, file: File) {
    setErr('')
    setUploading((prev) => ({ ...prev, [name]: true }))
    try {
      const form = new FormData()
      form.set('file', file)
      const { rel } = await api<{ rel: string }>('/api/tools/upload', { form })
      setValue(name, rel)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setUploading((prev) => ({ ...prev, [name]: false }))
    }
  }

  async function submit() {
    if (!tool) return
    const clientFieldErr: Record<string, string> = {}
    for (const input of tool.inputs) {
      if (input.required && !values[input.name]?.trim()) {
        clientFieldErr[input.name] = `「${input.label}」不能为空`
      }
    }
    if (Object.keys(clientFieldErr).length > 0) {
      setFieldErr(clientFieldErr)
      setErr('')
      return
    }
    setErr('')
    setFieldErr({})
    setSubmitting(true)
    try {
      const run = await api<{ id: string }>(`/api/tools/${tool.id}/run`, { body: { inputs: values } })
      router.push(`/tools/runs/${run.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_CREDITS') {
        setShowRecharge(true)
        loadWallet()
      } else {
        // 服务端 400 报错文案是「「字段 label」不能为空/不在可选项内/不是合法的图片路径」这类
        // （见 web/lib/cozeInputs.ts），先按「label」精确匹配（避免「标题」子串误吞「副标题」
        // 报错的子串命中问题）；没有带括号的精确命中，才退化成普通子串匹配，候选里取 label
        // 最长的那个（更长的 label 更不可能是别的字段名的子串，误配概率更低）；都匹配不到
        // 说明报错和字段无关（比如请求体整体格式错误），走顶部红条兜底
        const msg = (e as Error).message
        const exact = tool.inputs.find((input) => msg.includes(`「${input.label}」`))
        const matched = exact ?? tool.inputs
          .filter((input) => msg.includes(input.label))
          .sort((a, b) => b.label.length - a.label.length)[0]
        if (matched) setFieldErr({ [matched.name]: msg })
        else setErr(msg)
      }
      setSubmitting(false)
    }
  }

  if (!tool && err) {
    return (
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/tools" className="text-sm text-flame">← 返回工具广场</Link>
      </div>
    )
  }
  if (!tool) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>

  const anyUploading = Object.values(uploading).some(Boolean)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold">{tool.name}</h1>
          {tool.description && <p className="mt-1 text-sm text-ink3">{tool.description}</p>}
        </div>
        {wallet && (
          <button onClick={() => setShowRecharge(true)} className="card shrink-0 px-3.5 py-2 text-right">
            <p className="text-xs text-ink3">剩余积分</p>
            <p className="num text-lg font-bold">{wallet.credits}</p>
          </button>
        )}
      </div>

      <p className="pill pill-run w-fit">消耗 {tool.priceCredits} 积分</p>
      {prefillNote && <p className="pill pill-warn w-fit">{prefillNote}</p>}

      {(tool.demoVideoUrl || tool.tutorialVideoUrl) && (
        <div className={`grid gap-3 ${tool.demoVideoUrl && tool.tutorialVideoUrl ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {tool.demoVideoUrl && (
            <VideoCard src={tool.demoVideoUrl} title="成品演示" subtitle="生成效果预览" />
          )}
          {tool.tutorialVideoUrl && (
            <VideoCard src={tool.tutorialVideoUrl} title="使用教学" subtitle="怎么填下面的参数" />
          )}
        </div>
      )}

      <div className="space-y-3.5">
        {tool.inputs.map((input) => (
          <div key={input.name}>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5">
              <p className="eyebrow">
                {input.label}
                {input.required && <span className="ml-0.5 text-flame">*</span>}
              </p>
              <p className="text-[0.66rem] normal-case tracking-normal text-ink3">
                {input.required ? '必填' : '选填'}
                {input.placeholder ? ` · ${input.placeholder}` : ''}
              </p>
            </div>
            {input.type === 'text' && (
              <input className="field" value={values[input.name] ?? ''} placeholder={input.placeholder}
                onChange={(e) => setValue(input.name, e.target.value)} />
            )}
            {input.type === 'textarea' && (
              <textarea className="field min-h-[6rem]" value={values[input.name] ?? ''} placeholder={input.placeholder}
                onChange={(e) => setValue(input.name, e.target.value)} />
            )}
            {input.type === 'select' && (
              <select className="field" value={values[input.name] ?? ''}
                onChange={(e) => setValue(input.name, e.target.value)}>
                <option value="">请选择</option>
                {(input.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            )}
            {input.type === 'image' && (
              <div className="space-y-2">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-dashed border-line px-4 py-5 text-center text-xs text-ink3 transition active:scale-[0.99]">
                  <ImageIcon />
                  <span>{uploading[input.name] ? '上传中…' : '点击上传图片'}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadImage(input.name, file)
                    }} />
                </label>
                {values[input.name] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${values[input.name]}`} alt={input.label}
                    className="h-24 w-24 rounded-xl object-cover" />
                )}
              </div>
            )}
            {fieldErr[input.name] && <p className="mt-1 text-xs text-bad">{fieldErr[input.name]}</p>}
          </div>
        ))}
      </div>

      {err && <p className="pill pill-bad">{err}</p>}
      <button onClick={submit} disabled={submitting || anyUploading} className="btn-primary w-full">
        <BoltIcon />
        {submitting ? '提交中…' : `消耗 ${tool.priceCredits} 积分 · 开始生成`}
      </button>
      <p className="text-center text-[0.66rem] text-ink3">生成约需 3-10 分钟 · 失败自动退回积分</p>

      {showRecharge && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => setShowRecharge(false)}>
          <div className="card w-full max-w-sm space-y-4 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-display text-lg font-bold">
                {wallet && wallet.credits > 0 ? '积分充值' : '积分已用完'}
              </h3>
              <p className="mt-1 text-sm text-ink3">
                运行一次消耗 {tool.priceCredits} 积分。扫码添加导师微信充值，到账后即可继续使用
              </p>
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
