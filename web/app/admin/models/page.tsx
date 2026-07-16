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

export default function ModelsPage() {
  const [list, setList] = useState<Cap[]>([])
  const [keyInput, setKeyInput] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState('')

  async function load() { try { setList(await api<Cap[]>('/api/admin/models')) } catch (e) { setErr((e as Error).message) } }
  useEffect(() => { load() }, [])

  function upd(cap: string, patch: Partial<Cap>) { setList((l) => l.map((c) => (c.capability === cap ? { ...c, ...patch } : c))) }

  async function save(c: Cap) {
    setBusy(c.capability + ':save'); setErr(''); setMsg('')
    try {
      await api(`/api/admin/models/${c.capability}`, { method: 'PUT', body: { baseUrl: c.baseUrl, model: c.model, enabled: c.enabled, apiKey: keyInput[c.capability] || undefined } })
      setKeyInput((k) => ({ ...k, [c.capability]: '' })); setMsg(`${LABELS[c.capability].name} 已保存`); await load()
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
            <label className="block text-sm text-ink2">接口地址
              <input className="field mt-1" value={c.baseUrl} onChange={(e) => upd(c.capability, { baseUrl: e.target.value })} placeholder="https://relay.aitoken.homes/v1" autoCapitalize="none" /></label>
            <label className="block text-sm text-ink2">模型
              <input className="field mt-1" value={c.model} onChange={(e) => upd(c.capability, { model: e.target.value })} /></label>
            <label className="block text-sm text-ink2">密钥 {c.hasKey && <span className="text-ink3">（已设置，留空不改）</span>}
              <input className="field mt-1" type="password" value={keyInput[c.capability] ?? ''} onChange={(e) => setKeyInput((k) => ({ ...k, [c.capability]: e.target.value }))} placeholder={c.hasKey ? '••••••••' : ''} autoCapitalize="none" /></label>
            <div className="flex gap-2">
              <button onClick={() => save(c)} disabled={busy === c.capability + ':save'} className="btn-primary flex-1">保存</button>
              <button onClick={() => test(c)} disabled={busy === c.capability + ':test'} className="btn-ghost shrink-0">测试连通</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
