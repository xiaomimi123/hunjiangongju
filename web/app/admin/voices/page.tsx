'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

type Voice = { id: string; voiceId: string; name: string; sampleAssetUrl: string; createdAt: string }

export default function VoicesPage() {
  const [list, setList] = useState<Voice[]>([])
  const [name, setName] = useState('')
  const [sampleAssetUrl, setSampleAssetUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try { setList(await api<Voice[]>('/api/admin/voices')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  // 支持从拆解结果页「用此声音克隆」跳转时预填样本地址与名称（普通 DOM API 读取，
  // 避免引入 next/navigation 的 useSearchParams 导致的 CSR bailout/Suspense 要求）
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const u = sp.get('sampleAssetUrl')
    const n = sp.get('name')
    if (u) setSampleAssetUrl(u)
    if (n) setName(n)
  }, [])

  async function clone() {
    setErr(''); setMsg('')
    if (!name.trim()) { setErr('请填写音色名称'); return }
    if (!sampleAssetUrl.trim()) { setErr('请提供样本音频地址'); return }
    setBusy(true)
    try {
      await api<Voice>('/api/admin/voices', { body: { name: name.trim(), sampleAssetUrl: sampleAssetUrl.trim() } })
      setName(''); setSampleAssetUrl('')
      setMsg('音色克隆成功')
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="声音复刻" subtitle="克隆并管理音色，供发起生成时挑选" />
      {err && <p className="pill pill-bad">{err}</p>}
      {msg && <p className="pill pill-ok">{msg}</p>}

      <div className="card space-y-3 p-4">
        <p className="eyebrow">克隆新音色</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">音色名称</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 主播A" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">样本音频地址（URL）</span>
            <input className="field" value={sampleAssetUrl} onChange={(e) => setSampleAssetUrl(e.target.value)}
              placeholder="https://.../sample.wav" autoCapitalize="none" />
          </label>
        </div>
        <button onClick={clone} disabled={busy} className="btn-primary">{busy ? '克隆中…' : '＋ 克隆音色'}</button>
      </div>

      <section className="space-y-3">
        <p className="eyebrow">音色库（{list.length}）</p>
        {list.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink3">还没有克隆过音色，先在上方克隆一个。</p>
        ) : (
          <ul className="space-y-2.5">
            {list.map((v) => (
              <li key={v.id} className="card flex flex-wrap items-center gap-3 p-3">
                <span className="pill">{v.name}</span>
                <span className="text-xs text-ink3">{v.voiceId}</span>
                <audio controls src={v.sampleAssetUrl} className="h-9 min-w-[220px] flex-1" />
                <span className="num text-xs text-ink3">{new Date(v.createdAt).toLocaleString('zh-CN')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
