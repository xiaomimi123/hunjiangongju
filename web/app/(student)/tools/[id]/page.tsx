'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, ApiError } from '@/lib/fetcher'

type InputType = 'text' | 'textarea' | 'select' | 'image'
type ToolInput = { name: string; label: string; type: InputType; options?: string[]; placeholder?: string; required: boolean }
type Tool = { id: string; name: string; description: string | null; priceCredits: number; inputs: ToolInput[] }
type Wallet = { credits: number; qrUrl: string }

export default function ToolFormPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [tool, setTool] = useState<Tool | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
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

  function setValue(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }))
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
    for (const input of tool.inputs) {
      if (input.required && !values[input.name]?.trim()) {
        setErr(`「${input.label}」不能为空`)
        return
      }
    }
    setErr('')
    setSubmitting(true)
    try {
      const run = await api<{ id: string }>(`/api/tools/${tool.id}/run`, { body: { inputs: values } })
      router.push(`/tools/runs/${run.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_CREDITS') {
        setShowRecharge(true)
        loadWallet()
      } else {
        setErr((e as Error).message)
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

      <div className="space-y-3">
        {tool.inputs.map((input) => (
          <div key={input.name}>
            <p className="eyebrow mb-1.5">
              {input.label} {input.required && <span className="text-flame">*</span>}
            </p>
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
                <input type="file" accept="image/jpeg,image/png,image/webp" className="field"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadImage(input.name, file)
                  }} />
                {uploading[input.name] && <p className="text-xs text-ink3">上传中…</p>}
                {values[input.name] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${values[input.name]}`} alt={input.label}
                    className="h-24 w-24 rounded-xl object-cover" />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {err && <p className="pill pill-bad">{err}</p>}
      <button onClick={submit} disabled={submitting || anyUploading} className="btn-primary w-full">
        {submitting ? '提交中…' : `⚡ 运行（${tool.priceCredits} 积分）`}
      </button>

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
