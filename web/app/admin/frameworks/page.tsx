'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'

type FrameworkRow = { id: string; name: string | null; industryCategory: string | null; visualStyleType: string; published: boolean; degradedNote?: string | null; createdAt: string }
type FrameworkFull = {
  id: string; name: string | null; frameworkText: string; industryCategory: string | null
  imageStylePrompt: string | null; overlayTemplate: unknown; renderTemplate: string | null
  maxLines: number | null; maxTotalChars: number | null; suggestedSegmentCount: number | null
  visualStyleType: string
}

type Form = {
  name: string; frameworkText: string; industryCategory: string; imageStylePrompt: string
  overlayTemplate: string; renderTemplate: string; maxLines: string; maxTotalChars: string; suggestedSegmentCount: string
}

export default function FrameworksPage() {
  const [rows, setRows] = useState<FrameworkRow[] | null>(null)
  const [err, setErr] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [modalErr, setModalErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pubBusy, setPubBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await api<FrameworkRow[]>('/api/frameworks')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  const [deleting, setDeleting] = useState('')
  async function del(id: string, name: string) {
    if (!confirm(`确定删除框架「${name}」？将一并删除其下的生成任务及成片文件，不可恢复。`)) return
    setDeleting(id)
    try { await api(`/api/frameworks/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setErr((e as Error).message) }
    finally { setDeleting('') }
  }

  async function openEdit(id: string) {
    setEditId(id); setForm(null); setModalErr('')
    try {
      const f = await api<FrameworkFull>(`/api/frameworks/${id}`)
      setForm({
        name: f.name ?? '',
        frameworkText: f.frameworkText ?? '',
        industryCategory: f.industryCategory ?? '',
        imageStylePrompt: f.imageStylePrompt ?? '',
        overlayTemplate: f.overlayTemplate == null ? '' : JSON.stringify(f.overlayTemplate, null, 2),
        renderTemplate: f.renderTemplate ?? '',
        maxLines: f.maxLines == null ? '' : String(f.maxLines),
        maxTotalChars: f.maxTotalChars == null ? '' : String(f.maxTotalChars),
        suggestedSegmentCount: f.suggestedSegmentCount == null ? '' : String(f.suggestedSegmentCount),
      })
    } catch (e) { setModalErr((e as Error).message) }
  }

  const setF = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f))

  async function togglePublish(id: string, published: boolean) {
    setErr(''); setPubBusy(id)
    try {
      await api(`/api/frameworks/${id}`, { method: 'PATCH', body: { published } })
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setPubBusy(null) }
  }

  async function save() {
    if (!form || !editId) return
    setModalErr('')
    if (!form.frameworkText.trim()) { setModalErr('框架文案不能为空'); return }
    const body: Record<string, unknown> = {
      name: form.name,
      frameworkText: form.frameworkText,
      industryCategory: form.industryCategory,
      imageStylePrompt: form.imageStylePrompt,
      renderTemplate: form.renderTemplate,
      maxLines: form.maxLines.trim() === '' ? null : Number(form.maxLines),
      maxTotalChars: form.maxTotalChars.trim() === '' ? null : Number(form.maxTotalChars),
      suggestedSegmentCount: form.suggestedSegmentCount.trim() === '' ? null : Number(form.suggestedSegmentCount),
    }
    if (form.overlayTemplate.trim() === '') {
      body.overlayTemplate = null
    } else {
      try { body.overlayTemplate = JSON.parse(form.overlayTemplate) }
      catch { setModalErr('叠加模板需为合法 JSON'); return }
    }
    setBusy(true)
    try {
      await api(`/api/frameworks/${editId}`, { method: 'PATCH', body })
      setEditId(null); setForm(null)
      await load()
    } catch (e) { setModalErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="框架库" subtitle="拆解产出的可复用文案框架，可编辑供生成线调用" />
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">行业标签</th>
              <th className="px-4 py-3 font-medium">视觉风格</th>
              <th className="px-4 py-3 font-medium">成片库</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows?.map((f) => (
              <tr key={f.id} className="cursor-pointer hover:bg-surface2" onClick={() => openEdit(f.id)}>
                <td className="px-4 py-3 font-medium text-flame">
                  {f.name ?? f.id.slice(0, 8)}
                  {f.degradedNote && (
                    <span title={f.degradedNote} className="ml-2 cursor-help rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-600">
                      ⚠️ 降级
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink2">{f.industryCategory ?? '—'}</td>
                <td className="px-4 py-3 text-ink2">{f.visualStyleType}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePublish(f.id, !f.published) }}
                    disabled={pubBusy === f.id}
                    className={f.published ? 'btn-primary text-xs' : 'btn-ghost text-xs'}
                  >
                    {pubBusy === f.id ? '…' : f.published ? '取消发布' : '发布'}
                  </button>
                </td>
                <td className="num px-4 py-3 text-ink3">{new Date(f.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <span className="btn-ghost text-xs">编辑</span>
                  <button onClick={(e) => { e.stopPropagation(); del(f.id, f.name ?? f.id.slice(0, 8)) }}
                    disabled={deleting === f.id}
                    className="ml-3 text-xs text-ink3 hover:text-flame disabled:opacity-50">
                    {deleting === f.id ? '删除中…' : '删除'}
                  </button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink3">暂无框架，去「拆解」发起一个拆解任务</td></tr>
            )}
            {!rows && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink3">加载中…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={!!editId} onClose={() => { if (!busy) { setEditId(null); setForm(null) } }} title="编辑框架" wide>
        {!form ? (
          <p className="py-10 text-center text-sm text-ink3">{modalErr || '加载中…'}</p>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="eyebrow">名称</span>
              <input className="field mt-1" value={form.name} onChange={(e) => setF({ name: e.target.value })} />
            </label>
            <label className="block">
              <span className="eyebrow">框架文案</span>
              <textarea className="field mt-1 text-xs" rows={6} value={form.frameworkText} onChange={(e) => setF({ frameworkText: e.target.value })} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow">行业标签</span>
                <input className="field mt-1" value={form.industryCategory} onChange={(e) => setF({ industryCategory: e.target.value })} />
              </label>
              <label className="block">
                <span className="eyebrow">渲染模板</span>
                <input className="field mt-1" value={form.renderTemplate} onChange={(e) => setF({ renderTemplate: e.target.value })} placeholder="booklist" />
              </label>
            </div>
            <label className="block">
              <span className="eyebrow">图片风格提示词</span>
              <textarea className="field mt-1 text-xs" rows={3} value={form.imageStylePrompt} onChange={(e) => setF({ imageStylePrompt: e.target.value })} />
            </label>
            <label className="block">
              <span className="eyebrow">叠加模板（JSON）</span>
              <textarea className="field mt-1 font-mono text-xs" rows={4} value={form.overlayTemplate} onChange={(e) => setF({ overlayTemplate: e.target.value })} placeholder='{"title_card":"{{标题}} {{副标题}}","watermark":"{{账号}}"}' />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="eyebrow">最大行数</span>
                <input className="field mt-1" inputMode="numeric" value={form.maxLines} onChange={(e) => setF({ maxLines: e.target.value })} />
              </label>
              <label className="block">
                <span className="eyebrow">最大总字数</span>
                <input className="field mt-1" inputMode="numeric" value={form.maxTotalChars} onChange={(e) => setF({ maxTotalChars: e.target.value })} />
              </label>
              <label className="block">
                <span className="eyebrow">建议分段数</span>
                <input className="field mt-1" inputMode="numeric" value={form.suggestedSegmentCount} onChange={(e) => setF({ suggestedSegmentCount: e.target.value })} />
              </label>
            </div>
            {modalErr && <p className="pill pill-bad">{modalErr}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setEditId(null); setForm(null) }} disabled={busy} className="btn-ghost px-4">取消</button>
              <button onClick={save} disabled={busy} className="btn-primary px-5">{busy ? '保存中…' : '保存'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
