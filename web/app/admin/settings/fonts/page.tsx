'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

type BuiltinFont = { id: string; family: string; weight: 400 | 700; file: string; label: string }
type CustomFont = { id: string; label: string; family: string; weight: 400 | 700; createdAt: string }
type FontsRes = { builtin: BuiltinFont[]; custom: CustomFont[] }

export default function FontsPage() {
  const [data, setData] = useState<FontsRes | null>(null)
  const [label, setLabel] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { setData(await api<FontsRes>('/api/admin/fonts')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function upload(file: File) {
    setErr(''); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('label', label.trim())
      await api('/api/admin/fonts', { form: fd })
      setLabel('')
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  async function del(id: string) {
    if (!confirm('确认删除这款字体？已引用它的剪辑参数会静默回退为默认字体。')) return
    setErr('')
    try { await api(`/api/admin/fonts/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setErr((e as Error).message) }
  }

  if (!data && err) return <p className="pill pill-bad">{err}</p>
  if (!data) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>

  return (
    <div className="space-y-5">
      <PageHeader title="字体管理" subtitle="内置字体清单与自定义字体上传，供剪辑参数里的字幕/标题字体下拉选用" />
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card space-y-1.5 p-4 text-xs text-ink3">
        <p>上传字体的版权由上传者自负；内置字体均为 SIL OFL 或明确免费商用授权，可放心使用。</p>
        <p>站酷快乐体是展示体，只有 7055 个字形，生僻书名/作者名可能出现豆腐块，用前建议先预览；其余 4 款均 3 万字形以上。</p>
      </div>

      <div className="card space-y-3 p-4">
        <p className="eyebrow">上传自定义字体</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">显示名（可选，留空用字体自身族名）</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如 品牌专用黑体"
              className="field w-56" />
          </label>
          <input ref={fileRef} type="file" accept=".ttf,.otf" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary">
            {busy ? '上传中…' : '＋ 选择字体文件上传（.ttf / .otf）'}
          </button>
        </div>
        <p className="text-xs text-ink3">内部族名与字重都从字体文件自动解析，解析失败即拒收（不接受手填，避免成片静默回退默认字体）。</p>
      </div>

      <section className="space-y-2.5">
        <p className="eyebrow">字体清单（{data.builtin.length + data.custom.length}）</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink3">
                <th className="px-2 py-2">显示名</th>
                <th className="px-2 py-2">内部族名</th>
                <th className="px-2 py-2">字重</th>
                <th className="px-2 py-2">来源</th>
                <th className="px-2 py-2">上传时间</th>
                <th className="px-2 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.builtin.map((f) => (
                <tr key={f.id} className="border-b border-line/50">
                  <td className="px-2 py-2">{f.label}</td>
                  <td className="px-2 py-2 text-ink3">{f.family}</td>
                  <td className="px-2 py-2 text-ink3">{f.weight}</td>
                  <td className="px-2 py-2"><span className="pill">内置</span></td>
                  <td className="px-2 py-2 text-ink3">—</td>
                  <td className="px-2 py-2 text-ink3">不可删除</td>
                </tr>
              ))}
              {data.custom.map((f) => (
                <tr key={f.id} className="border-b border-line/50">
                  <td className="px-2 py-2">{f.label}</td>
                  <td className="px-2 py-2 text-ink3">{f.family}</td>
                  <td className="px-2 py-2 text-ink3">{f.weight}</td>
                  <td className="px-2 py-2"><span className="pill">上传</span></td>
                  <td className="px-2 py-2 text-ink3">{new Date(f.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2"><button onClick={() => del(f.id)} className="btn-danger text-xs">删除</button></td>
                </tr>
              ))}
              {data.custom.length === 0 && data.builtin.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-ink3">还没有字体</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
