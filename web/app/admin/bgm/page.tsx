'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

type Bgm = { id: string; fileUrl: string; styleTag: string | null; durationMs: number | null }

export default function BgmPage() {
  const [list, setList] = useState<Bgm[]>([])
  const [styleTag, setStyleTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { setList(await api<Bgm[]>('/api/bgm')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function upload(file: File) {
    setErr(''); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('styleTag', styleTag.trim())
      await api<Bgm>('/api/bgm', { form: fd })
      setStyleTag('')
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  async function del(id: string) {
    if (!confirm('确认删除这首 BGM？')) return
    setErr('')
    try { await api(`/api/bgm/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="BGM 曲库" subtitle="上传背景音乐（mp3），合成时供每个任务挑选" />
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card space-y-3 p-4">
        <p className="eyebrow">上传新 BGM</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">风格标签（可选）</span>
            <input value={styleTag} onChange={(e) => setStyleTag(e.target.value)} placeholder="如 治愈 / 燃 / 悬疑"
              className="field w-48" />
          </label>
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.m4a" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary">
            {busy ? '上传中…' : '＋ 选择音频上传'}
          </button>
        </div>
      </div>

      <section className="space-y-3">
        <p className="eyebrow">曲库（{list.length}）</p>
        {list.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink3">曲库还是空的，先上传一首 mp3。</p>
        ) : (
          <ul className="space-y-2.5">
            {list.map((b) => (
              <li key={b.id} className="card flex flex-wrap items-center gap-3 p-3">
                <span className="pill">{b.styleTag || '未标注'}</span>
                <audio controls src={b.fileUrl} className="h-9 min-w-[220px] flex-1" />
                <button onClick={() => del(b.id)} className="btn-danger text-xs">删除</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
