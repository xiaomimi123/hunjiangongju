'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

type Banner = {
  id: string
  title: string
  body: string | null
  linkUrl: string | null
  enabled: boolean
  sortOrder: number
  createdAt: string
}

type FormState = {
  title: string
  body: string
  linkUrl: string
  sortOrder: string
}

function blankForm(): FormState {
  return { title: '', body: '', linkUrl: '', sortOrder: '0' }
}

function toForm(b: Banner): FormState {
  return { title: b.title, body: b.body ?? '', linkUrl: b.linkUrl ?? '', sortOrder: String(b.sortOrder) }
}

// 校验规则与后端一致（title 1-60、body ≤200、linkUrl /开头或 https、sortOrder 0-999），
// 新增表单和行内编辑表单共用同一份，避免两处漂移。
function validateFields(f: FormState): string {
  if (!f.title.trim() || f.title.trim().length > 60) return '标题为 1-60 字'
  if (f.body.trim().length > 200) return '正文最多 200 字'
  const link = f.linkUrl.trim()
  if (link && !(link.startsWith('/') || link.startsWith('https://'))) return '链接需以 / 开头或为 https 链接'
  const sortOrder = Number(f.sortOrder)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) return '排序必须是 0-999 的整数'
  return ''
}

export default function BannersPage() {
  const [banners, setBanners] = useState<Banner[] | null>(null)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState('')

  const [form, setForm] = useState<FormState>(blankForm())
  const [formErr, setFormErr] = useState('')
  const [formBusy, setFormBusy] = useState(false)

  // 行内编辑：editingId 为空表示没有行处于编辑态
  const [editingId, setEditingId] = useState('')
  const [editForm, setEditForm] = useState<FormState>(blankForm())
  const [editErr, setEditErr] = useState('')
  const [editBusy, setEditBusy] = useState(false)

  const load = useCallback(async () => {
    try { setBanners((await api<{ banners: Banner[] }>('/api/admin/banners')).banners) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function toggleEnabled(b: Banner) {
    setBusyId(b.id); setErr('')
    try {
      await api(`/api/admin/banners/${b.id}`, { method: 'PATCH', body: { enabled: !b.enabled } })
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusyId('') }
  }

  async function remove(b: Banner) {
    if (!confirm(`确定删除公告「${b.title}」？`)) return
    setBusyId(b.id); setErr('')
    try {
      await api(`/api/admin/banners/${b.id}`, { method: 'DELETE' })
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusyId('') }
  }

  async function submit() {
    const v = validateFields(form)
    if (v) { setFormErr(v); return }
    setFormBusy(true); setFormErr('')
    try {
      await api('/api/admin/banners', {
        body: {
          title: form.title.trim(),
          body: form.body.trim(),
          linkUrl: form.linkUrl.trim(),
          sortOrder: Number(form.sortOrder),
        },
      })
      setForm(blankForm())
      await load()
    } catch (e) { setFormErr((e as Error).message) }
    finally { setFormBusy(false) }
  }

  function startEdit(b: Banner) {
    setEditingId(b.id); setEditForm(toForm(b)); setEditErr('')
  }
  function cancelEdit() {
    if (editBusy) return
    setEditingId(''); setEditErr('')
  }
  async function saveEdit(id: string) {
    const v = validateFields(editForm)
    if (v) { setEditErr(v); return }
    setEditBusy(true); setEditErr('')
    try {
      await api(`/api/admin/banners/${id}`, {
        method: 'PATCH',
        body: {
          title: editForm.title.trim(),
          body: editForm.body.trim(),
          linkUrl: editForm.linkUrl.trim(),
          sortOrder: Number(editForm.sortOrder),
        },
      })
      setEditingId('')
      await load()
    } catch (e) { setEditErr((e as Error).message) }
    finally { setEditBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="公告 Banner" subtitle="首页顶部滚动公告：新增、编辑、上下架、排序" />
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card space-y-3 p-4">
        <p className="eyebrow">新增公告</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">标题</span>
            <input className="field" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="如 暑期活动开启" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">排序（越小越靠前）</span>
            <input className="field num" inputMode="numeric" value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value.replace(/\D/g, '').slice(0, 3) }))} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-ink3">正文（可选）</span>
          <input className="field" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="公告详情，最多 200 字" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink3">链接（可选，/ 开头或 https）</span>
          <input className="field" value={form.linkUrl} onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))} placeholder="/activity 或 https://..." />
        </label>
        {formErr && <p className="pill pill-bad">{formErr}</p>}
        <div className="flex justify-end">
          <button onClick={submit} disabled={formBusy} className="btn-primary px-5">{formBusy ? '保存中…' : '＋ 新增'}</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">标题</th>
              <th className="px-4 py-3 font-medium">正文</th>
              <th className="px-4 py-3 text-right font-medium">排序</th>
              <th className="px-4 py-3 text-center font-medium">启用</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {banners?.map((b) => (
              editingId === b.id ? (
                <tr key={b.id}>
                  <td colSpan={5} className="px-4 py-3">
                    <div className="space-y-2 rounded-lg bg-surface2 p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <input className="field text-xs" value={editForm.title} placeholder="标题"
                          onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
                        <input className="field num text-xs" inputMode="numeric" value={editForm.sortOrder} placeholder="排序"
                          onChange={(e) => setEditForm((f) => ({ ...f, sortOrder: e.target.value.replace(/\D/g, '').slice(0, 3) }))} />
                      </div>
                      <input className="field text-xs" value={editForm.body} placeholder="正文（可选，最多 200 字）"
                        onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))} />
                      <input className="field text-xs" value={editForm.linkUrl} placeholder="链接（可选，/ 开头或 https）"
                        onChange={(e) => setEditForm((f) => ({ ...f, linkUrl: e.target.value }))} />
                      {editErr && <p className="pill pill-bad">{editErr}</p>}
                      <div className="flex justify-end gap-2">
                        <button onClick={cancelEdit} className="btn-ghost px-3 py-1 text-xs">取消</button>
                        <button onClick={() => saveEdit(b.id)} disabled={editBusy} className="btn-primary px-3 py-1 text-xs">
                          {editBusy ? '保存中…' : '保存'}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={b.id} className={b.enabled ? '' : 'opacity-55'}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{b.title}</p>
                    {b.linkUrl && <p className="mt-0.5 text-xs text-ink3">{b.linkUrl}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink3">{b.body ? (b.body.length > 30 ? `${b.body.slice(0, 30)}…` : b.body) : '—'}</td>
                  <td className="num px-4 py-3 text-right text-ink3">{b.sortOrder}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleEnabled(b)}
                      disabled={busyId === b.id}
                      className={`pill ${b.enabled ? 'pill-ok' : ''}`}
                    >
                      {busyId === b.id ? '处理中…' : b.enabled ? '已启用' : '已停用'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3 whitespace-nowrap text-sm">
                      <button onClick={() => startEdit(b)} className="text-ink2 hover:text-ink">编辑</button>
                      <button onClick={() => remove(b)} disabled={busyId === b.id} className="text-bad disabled:text-ink3">删除</button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {banners && banners.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink3">还没有公告，在上方新增</td></tr>
            )}
          </tbody>
        </table>
        {!banners && <p className="py-10 text-center text-sm text-ink3">加载中…</p>}
      </div>
    </div>
  )
}
