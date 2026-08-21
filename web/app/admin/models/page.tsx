'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

type Cap = { capability: string; baseUrl: string; model: string; enabled: boolean; extra: Record<string, unknown>; hasKey: boolean }
const LABELS: Record<string, { name: string; hint: string }> = {
  llm: { name: 'LLM 文案', hint: '框架提炼 + 文案生成' },
  image: { name: '文生图', hint: '逐段插画生成' },
  tts: { name: 'TTS 配音', hint: '整篇一次性配音' },
  asr: { name: 'ASR 转写', hint: '原视频语音转文字' },
}

/**
 * 试生成：填模型名 + 提示词，直接出一张图。
 *
 * 换生图模型原先只能靠猜模型名 + 跑一整条任务（几分钟，还要等文案与配音）才看得到效果。
 * 这里只做一次生图调用，几秒出图，可以把候选模型挨个比过去，选定了再写进上面的配置。
 * **不落库、不改配置**——填的东西只对这一次调用生效。
 */
function TryImage() {
  const [prompt, setPrompt] = useState('男性少年面部特写，日系动漫风格，细腻笔触，柔和光影，蓝灰色调，清澈蓝色眼眸')
  const [model, setModel] = useState('')
  const [size, setSize] = useState('720x960')
  const [credsFrom, setCredsFrom] = useState('image')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shots, setShots] = useState<{ url: string; model: string; ms: number; size: string }[]>([])
  const [avail, setAvail] = useState<{ endpoint: string; models: string[] } | null>(null)

  // 列出该端点可用的模型 —— 换模型时先看有什么，比猜名字快得多
  async function listModels() {
    setBusy(true); setErr(''); setAvail(null)
    try {
      const res = await fetch(`/api/admin/models/available?credsFrom=${credsFrom}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      setAvail(j)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/admin/image/try', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model, size, credsFrom }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      // 新的排在前面：换模型时最有用的是"刚才那张 vs 这张"的直接对比
      setShots((p) => [{
        url: URL.createObjectURL(blob),
        model: decodeURIComponent(res.headers.get('X-Gen-Model') ?? model ?? ''),
        ms: Number(res.headers.get('X-Gen-Ms') ?? 0),
        size,
      }, ...p].slice(0, 8))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mt-6 space-y-3 p-5">
      <div>
        <p className="font-display font-bold">试生成</p>
        <p className="text-xs text-ink3">
          换模型前先在这里比效果：只做一次生图调用，不改上面的配置。
          「借用凭据」是指用哪个能力的接口地址与密钥——想在百炼标准平台试
          qwen-image，而 image 指向 MAAS 专属端点时，借 asr / vision 那把即可。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="text-sm text-ink2">借用凭据
          <select className="field mt-1 w-32" value={credsFrom} onChange={(e) => setCredsFrom(e.target.value)}>
            {['image', 'llm', 'asr', 'vision'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex-1 text-sm text-ink2">模型名（留空用该能力当前配置的模型）
          <input className="field mt-1" value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 qwen-image / wan2.7-image" autoCapitalize="none" />
        </label>
        <label className="text-sm text-ink2">尺寸
          <input className="field mt-1 w-28" value={size} onChange={(e) => setSize(e.target.value)} placeholder="720x960" />
        </label>
      </div>
      <label className="block text-sm text-ink2">提示词
        <textarea className="field mt-1 text-xs" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button onClick={run} disabled={busy || !prompt.trim()} className="btn-primary">
          {busy ? '生成中…' : '生成一张'}
        </button>
        <button onClick={listModels} disabled={busy} className="btn-ghost">列出可用模型</button>
      </div>
      {avail && (
        <div className="rounded border border-line p-2 text-xs">
          <p className="text-ink3">{avail.endpoint} · 共 {avail.models.length} 个</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {avail.models.map((m) => (
              <button key={m} type="button" className="btn-ghost text-[11px]" onClick={() => setModel(m)}>{m}</button>
            ))}
          </div>
        </div>
      )}
      {err && <p className="pill pill-bad break-all">{err}</p>}
      {shots.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {shots.map((s, i) => (
            <figure key={s.url} className="w-40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={`试生成 ${i + 1}`} className="w-full rounded border border-line" />
              <figcaption className="mt-1 break-all text-[11px] text-ink3">
                {s.model || '(默认模型)'} · {s.size} · {(s.ms / 1000).toFixed(1)}s
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ModelsPage() {
  const [list, setList] = useState<Cap[]>([])
  const [keyInput, setKeyInput] = useState<Record<string, string>>({})
  // extra 的文本态单独存：JSON 边打边不合法是常态，不能每敲一个字就往 Cap.extra 里塞对象
  const [extraText, setExtraText] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState('')

  async function load() { try { setList(await api<Cap[]>('/api/admin/models')) } catch (e) { setErr((e as Error).message) } }
  useEffect(() => { load() }, [])

  function upd(cap: string, patch: Partial<Cap>) { setList((l) => l.map((c) => (c.capability === cap ? { ...c, ...patch } : c))) }

  async function save(c: Cap) {
    setBusy(c.capability + ':save'); setErr(''); setMsg('')
    try {
      // extra 必须在**保存前**校验并整体拒绝：写进去一个坏 JSON，
      // 表现是「音色下拉里那两个克隆音色莫名其妙不见了」，而不会有任何报错。
      let extra: unknown
      const raw = extraText[c.capability]
      if (raw !== undefined) {
        const t = raw.trim()
        if (!t) extra = {}
        else {
          try { extra = JSON.parse(t) } catch { throw new Error('高级参数不是合法 JSON，请检查引号与逗号') }
          if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('高级参数必须是一个 JSON 对象')
        }
      }
      await api(`/api/admin/models/${c.capability}`, {
        method: 'PUT',
        body: {
          baseUrl: c.baseUrl, model: c.model, enabled: c.enabled,
          apiKey: keyInput[c.capability] || undefined,
          ...(extra !== undefined ? { extra } : {}),
        },
      })
      setKeyInput((k) => ({ ...k, [c.capability]: '' }))
      setExtraText((t) => { const n = { ...t }; delete n[c.capability]; return n })
      setMsg(`${LABELS[c.capability].name} 已保存`); await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  async function test(c: Cap) {
    setBusy(c.capability + ':test'); setErr(''); setMsg('')
    try { const r = await api<{ ok: boolean; detail: string }>(`/api/admin/models/${c.capability}/test`, { method: 'POST' }); setMsg(`${LABELS[c.capability].name} 测试：${r.detail}`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }

  return (
    <div>
      <PageHeader title="模型配置" subtitle="配置各 AI 能力的接口地址、密钥与模型；未启用时走内置 mock" />
      {err && <p className="pill pill-bad mb-4">{err}</p>}
      {msg && <p className="pill pill-ok mb-4">{msg}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((c) => (
          <div key={c.capability} className="card space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-display font-bold">{LABELS[c.capability]?.name ?? c.capability}</p>
                <p className="text-xs text-ink3">{LABELS[c.capability]?.hint}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">启用
                <input type="checkbox" checked={c.enabled} onChange={(e) => upd(c.capability, { enabled: e.target.checked })} className="h-5 w-5" />
              </label>
            </div>
            {c.capability === 'tts' && (
              <p className="text-xs text-ink3">火山配音(豆包语音合成2.0)：接口地址填 https://openspeech.bytedance.com/api/v3/tts/unidirectional，模型填 seed-tts-2.0，密钥填「语音技术」控制台的 API Key（非火山方舟的 ark- key）。克隆音色：火山声音复刻2.0 克隆得 S_ 开头音色ID，填入 extra 的 customVoices（如 {'{"customVoices":[{"id":"S_xxx","label":"我的对标男声"}]}'}）即出现在生成页</p>
            )}
            <label className="block text-sm text-ink2">接口地址
              <input className="field mt-1" value={c.baseUrl} onChange={(e) => upd(c.capability, { baseUrl: e.target.value })} placeholder="https://relay.aitoken.homes/v1" autoCapitalize="none" /></label>
            <label className="block text-sm text-ink2">模型
              <input className="field mt-1" value={c.model} onChange={(e) => upd(c.capability, { model: e.target.value })} /></label>
            <label className="block text-sm text-ink2">密钥 {c.hasKey && <span className="text-ink3">（已设置，留空不改）</span>}
              <input className="field mt-1" type="password" value={keyInput[c.capability] ?? ''} onChange={(e) => setKeyInput((k) => ({ ...k, [c.capability]: e.target.value }))} placeholder={c.hasKey ? '••••••••' : ''} autoCapitalize="none" /></label>
            <label className="block text-sm text-ink2">高级参数（JSON，留空为 {}）
              <textarea
                className="field mt-1 font-mono text-xs"
                rows={3}
                value={extraText[c.capability] ?? JSON.stringify(c.extra ?? {}, null, 2)}
                onChange={(e) => setExtraText((t) => ({ ...t, [c.capability]: e.target.value }))}
                spellCheck={false}
                placeholder={'{"customVoices":[{"id":"S_xxx","label":"我的男声"}]}'}
              />
            </label>
            <div className="flex gap-2">
              <button onClick={() => save(c)} disabled={busy === c.capability + ':save'} className="btn-primary flex-1">保存</button>
              <button onClick={() => test(c)} disabled={busy === c.capability + ':test'} className="btn-ghost shrink-0">测试连通</button>
            </div>
          </div>
        ))}
      </div>
      <TryImage />
    </div>
  )
}
