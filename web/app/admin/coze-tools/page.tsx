'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

const INPUT_TYPES = ['text', 'textarea', 'select', 'image'] as const
type CozeInputType = (typeof INPUT_TYPES)[number]
const TYPE_LABELS: Record<CozeInputType, string> = { text: '单行文本', textarea: '多行文本', select: '下拉选择', image: '图片' }

type CozeToolInput = {
  name: string
  label: string
  type: CozeInputType
  options?: string[]
  placeholder?: string
  required: boolean
}

// select 选项的逗号分隔字符串解析：只在失焦/提交前调用，输入过程中绝不调用——
// 打字期间就 split/filter 会在敲下逗号那一刻把它吃掉（受控输入框经典坑）。
function parseOptions(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean)
}

type Tool = {
  id: string
  name: string
  description: string
  workflowId: string
  inputs: CozeToolInput[]
  priceCredits: number
  enabled: boolean
  sortOrder: number
  createdAt: string
}

type Run = {
  id: string
  toolId: string
  userId: string
  status: string
  errorMsg: string | null
  creditsCost: number
  createdAt: string
  finishedAt: string | null
}

const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: '排队中',
  RUNNING: '运行中',
  SUCCESS: '成功',
  FAILED: '失败',
}
const RUN_STATUS_TONE: Record<string, string> = {
  QUEUED: 'pill', RUNNING: 'pill-warn', SUCCESS: 'pill-ok', FAILED: 'pill-bad',
}

// 表单里一行输入项：options 换成 optionsText（原始逗号分隔字符串，随打字保留原样，
// 不在 onChange 里 split/filter）。canonical 的 options 数组只在校验/提交时现算。
type FormInput = {
  name: string
  label: string
  type: CozeInputType
  optionsText: string
  placeholder?: string
  required: boolean
}

// 编辑表单里一行输入项的默认值
function blankInput(): FormInput {
  return { name: '', label: '', type: 'text', optionsText: '', required: false }
}

type FormState = {
  name: string
  description: string
  workflowId: string
  priceCredits: string
  sortOrder: string
  enabled: boolean
  inputs: FormInput[]
}

function blankForm(): FormState {
  return { name: '', description: '', workflowId: '', priceCredits: '1', sortOrder: '0', enabled: false, inputs: [] }
}

function toForm(t: Tool): FormState {
  return {
    name: t.name,
    description: t.description,
    workflowId: t.workflowId,
    priceCredits: String(t.priceCredits),
    sortOrder: String(t.sortOrder),
    enabled: t.enabled,
    inputs: t.inputs.map((i) => ({
      name: i.name, label: i.label, type: i.type, required: i.required,
      placeholder: i.placeholder,
      optionsText: (i.options ?? []).join(','),
    })),
  }
}

export default function CozeToolsPage() {
  const [tools, setTools] = useState<Tool[] | null>(null)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState('')

  // 编辑弹窗：editing === 'new' 是新建，否则是被编辑工具的 id；null 表示关闭
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(blankForm())
  const [formErr, setFormErr] = useState('')
  const [formBusy, setFormBusy] = useState(false)

  const [fetchBusy, setFetchBusy] = useState(false)
  const [fetchHint, setFetchHint] = useState('')
  const [fetchErr, setFetchErr] = useState('')

  const [probeBusy, setProbeBusy] = useState(false)
  const [probeWarning, setProbeWarning] = useState('')
  const [probeErr, setProbeErr] = useState('')

  const [runs, setRuns] = useState<Run[] | null>(null)
  const [runsCursor, setRunsCursor] = useState<string | undefined>(undefined)
  const [runsErr, setRunsErr] = useState('')
  const [runsBusy, setRunsBusy] = useState(false)
  const [runsToolId, setRunsToolId] = useState('')

  const load = useCallback(async () => {
    try { setTools((await api<{ tools: Tool[] }>('/api/admin/coze-tools')).tools) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  const loadRuns = useCallback(async (toolId: string) => {
    setRunsBusy(true); setRunsErr('')
    try {
      const q = toolId ? `?toolId=${encodeURIComponent(toolId)}` : ''
      const r = await api<{ runs: Run[]; nextCursor?: string }>(`/api/admin/coze-tools/runs${q}`)
      setRuns(r.runs); setRunsCursor(r.nextCursor)
    } catch (e) { setRunsErr((e as Error).message) }
    finally { setRunsBusy(false) }
  }, [])
  useEffect(() => { loadRuns(runsToolId) }, [runsToolId, loadRuns])

  async function loadMoreRuns() {
    if (!runsCursor) return
    setRunsBusy(true); setRunsErr('')
    try {
      const q = new URLSearchParams({ cursor: runsCursor })
      if (runsToolId) q.set('toolId', runsToolId)
      const r = await api<{ runs: Run[]; nextCursor?: string }>(`/api/admin/coze-tools/runs?${q}`)
      setRuns((prev) => [...(prev ?? []), ...r.runs]); setRunsCursor(r.nextCursor)
    } catch (e) { setRunsErr((e as Error).message) }
    finally { setRunsBusy(false) }
  }

  function openNew() {
    setEditing('new'); setForm(blankForm()); setFormErr(''); setFetchErr(''); setFetchHint(''); setProbeErr(''); setProbeWarning('')
  }
  function openEdit(t: Tool) {
    setEditing(t.id); setForm(toForm(t)); setFormErr(''); setFetchErr(''); setFetchHint(''); setProbeErr(''); setProbeWarning('')
  }
  function closeForm() {
    if (formBusy) return
    setEditing(null)
  }

  async function toggleEnabled(t: Tool) {
    setBusyId(t.id); setErr('')
    try {
      await api(`/api/admin/coze-tools/${t.id}`, { method: 'PATCH', body: { enabled: !t.enabled } })
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusyId('') }
  }

  async function remove(t: Tool) {
    if (!confirm(`确定删除工具「${t.name}」？`)) return
    setBusyId(t.id); setErr('')
    try {
      const r = await api<{ ok: boolean; disabled?: boolean; hint?: string }>(`/api/admin/coze-tools/${t.id}`, { method: 'DELETE' })
      if (r.hint) setErr(r.hint)
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusyId('') }
  }

  function updateInput(i: number, patch: Partial<FormInput>) {
    setForm((f) => {
      const inputs = f.inputs.slice()
      inputs[i] = { ...inputs[i], ...patch }
      return { ...f, inputs }
    })
  }
  function addInput() {
    setForm((f) => ({ ...f, inputs: [...f.inputs, blankInput()] }))
  }
  function removeInput(i: number) {
    setForm((f) => ({ ...f, inputs: f.inputs.filter((_, idx) => idx !== i) }))
  }

  async function fetchParams() {
    if (!form.workflowId.trim()) { setFetchErr('请先填写 workflowId'); return }
    setFetchBusy(true); setFetchErr(''); setFetchHint('')
    try {
      const r = await api<{ params: { name: string; type?: string; required?: boolean }[] | null; hint?: string }>(
        '/api/admin/coze-tools/fetch-params', { body: { workflowId: form.workflowId.trim() } }
      )
      if (r.params === null) {
        setFetchHint(r.hint ?? '扣子未提供参数查询，请手动添加输入项')
      } else {
        const mapType = (t?: string): CozeInputType =>
          (INPUT_TYPES as readonly string[]).includes(t ?? '') ? (t as CozeInputType) : 'text'
        setForm((f) => ({
          ...f,
          inputs: r.params!.map((p) => ({
            name: p.name,
            label: p.name,
            type: mapType(p.type),
            required: p.required === true,
            optionsText: '',
          })),
        }))
        setFetchHint('已拉取参数，请为每项补充中文标签')
      }
    } catch (e) { setFetchErr((e as Error).message) }
    finally { setFetchBusy(false) }
  }

  // 自动探测：workflowId 已知但扣子该版本没有参数查询接口时用——后端会故意跑一次
  // 流式运行，靠参数校验报错反推参数表。合并进现有 inputs 时同名跳过不覆盖，
  // 避免把运营已经手填的中文标签/占位提示冲掉。
  async function probeParams() {
    if (!form.workflowId.trim()) { setProbeErr('请先填写 workflowId'); return }
    setProbeBusy(true); setProbeErr(''); setProbeWarning('')
    try {
      const r = await api<{ fields: { name: string; type: 'text' | 'image'; required: true }[]; warning?: string; error?: string }>(
        '/api/admin/coze-tools/probe-params', { body: { workflowId: form.workflowId.trim() } }
      )
      setForm((f) => {
        const existingNames = new Set(f.inputs.map((i) => i.name))
        // 纵深防御：后端已按 name 去重，这里再兜一道——万一某次响应里仍带了同名字段，
        // 批内也只取第一条，不往 inputs 里塞出重名行（重名行会踩 validateInputs 的查重）
        const seenInBatch = new Set<string>()
        const added: FormInput[] = r.fields
          .filter((field) => {
            if (existingNames.has(field.name) || seenInBatch.has(field.name)) return false
            seenInBatch.add(field.name)
            return true
          })
          .map((field) => ({
            name: field.name,
            label: field.name,
            type: field.type === 'image' ? 'image' : 'text',
            required: field.required,
            optionsText: '',
          }))
        return { ...f, inputs: [...f.inputs, ...added] }
      })
      if (r.warning) setProbeWarning(r.warning)
      else if (r.error) setProbeErr(r.error)
    } catch (e) { setProbeErr((e as Error).message) }
    finally { setProbeBusy(false) }
  }

  function validateForm(): string {
    if (!form.name.trim()) return '请填写名称'
    if (!form.workflowId.trim()) return '请填写 workflowId'
    const priceCredits = Number(form.priceCredits)
    if (!Number.isInteger(priceCredits) || priceCredits < 0 || priceCredits > 1000) return '价格必须是 0-1000 的整数'
    const sortOrder = Number(form.sortOrder)
    if (!Number.isInteger(sortOrder)) return '排序必须是整数'
    for (let i = 0; i < form.inputs.length; i++) {
      const inp = form.inputs[i]
      const at = `第 ${i + 1} 项输入`
      if (!/^[\w-]{1,64}$/.test(inp.name)) return `${at}：参数名不合法（只能是字母/数字/下划线/短横线）`
      if (!inp.label.trim()) return `${at}：中文标签不能为空`
      if (inp.type === 'select' && parseOptions(inp.optionsText).length === 0) return `${at}：下拉选择需要至少一个选项`
    }
    return ''
  }

  async function save() {
    const v = validateForm()
    if (v) { setFormErr(v); return }
    setFormBusy(true); setFormErr('')
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      workflowId: form.workflowId.trim(),
      priceCredits: Number(form.priceCredits),
      sortOrder: Number(form.sortOrder),
      enabled: form.enabled,
      inputs: form.inputs.map((i) => ({
        name: i.name,
        label: i.label.trim(),
        type: i.type,
        required: i.required,
        ...(i.type === 'select' ? { options: parseOptions(i.optionsText) } : {}),
        ...(i.placeholder ? { placeholder: i.placeholder } : {}),
      })),
    }
    try {
      if (editing === 'new') {
        await api('/api/admin/coze-tools', { body })
      } else if (editing) {
        await api(`/api/admin/coze-tools/${editing}`, { method: 'PATCH', body })
      }
      setEditing(null)
      await load()
    } catch (e) { setFormErr((e as Error).message) }
    finally { setFormBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="扣子工具" subtitle="扣子工作流工具箱：导入、编辑、上下架，以及学员调用记录">
        <button onClick={openNew} className="btn-primary px-4">＋ 新建工具</button>
      </PageHeader>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">workflowId</th>
              <th className="px-4 py-3 text-right font-medium">价格（积分）</th>
              <th className="px-4 py-3 text-right font-medium">排序</th>
              <th className="px-4 py-3 text-center font-medium">上架</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tools?.map((t) => (
              <tr key={t.id} className={t.enabled ? '' : 'opacity-55'}>
                <td className="px-4 py-3">
                  <p className="font-medium">{t.name}</p>
                  {t.description && <p className="mt-0.5 text-xs text-ink3">{t.description}</p>}
                </td>
                <td className="num px-4 py-3 text-ink3">{t.workflowId}</td>
                <td className="num px-4 py-3 text-right">{t.priceCredits}</td>
                <td className="num px-4 py-3 text-right text-ink3">{t.sortOrder}</td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => toggleEnabled(t)}
                    disabled={busyId === t.id}
                    className={`pill ${t.enabled ? 'pill-ok' : ''}`}
                  >
                    {busyId === t.id ? '处理中…' : t.enabled ? '已上架' : '已下架'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap text-sm">
                    <button onClick={() => openEdit(t)} className="text-ink2 hover:text-ink">编辑</button>
                    <button onClick={() => remove(t)} disabled={busyId === t.id} className="text-bad disabled:text-ink3">删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {tools && tools.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink3">还没有工具，点击右上角新建</td></tr>
            )}
          </tbody>
        </table>
        {!tools && <p className="py-10 text-center text-sm text-ink3">加载中…</p>}
      </div>

      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow">运行记录</p>
          <select className="field w-56" value={runsToolId} onChange={(e) => setRunsToolId(e.target.value)}>
            <option value="">全部工具</option>
            {tools?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {runsErr && <p className="pill pill-bad">{runsErr}</p>}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-left text-ink3">
              <tr>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 text-right font-medium">消耗积分</th>
                <th className="px-4 py-3 font-medium">发起时间</th>
                <th className="px-4 py-3 font-medium">完成时间</th>
                <th className="px-4 py-3 font-medium">失败原因</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs?.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <span className={`pill ${RUN_STATUS_TONE[r.status] ?? ''}`}>{RUN_STATUS_LABELS[r.status] ?? r.status}</span>
                  </td>
                  <td className="num px-4 py-3 text-ink3">{r.userId}</td>
                  <td className="num px-4 py-3 text-right">{r.creditsCost}</td>
                  <td className="num px-4 py-3 text-ink3">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                  <td className="num px-4 py-3 text-ink3">{r.finishedAt ? new Date(r.finishedAt).toLocaleString('zh-CN') : '—'}</td>
                  <td className="px-4 py-3 text-bad">{r.errorMsg ?? ''}</td>
                </tr>
              ))}
              {runs && runs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-ink3">暂无运行记录</td></tr>
              )}
            </tbody>
          </table>
          {!runs && <p className="py-10 text-center text-sm text-ink3">加载中…</p>}
        </div>
        {runsCursor && (
          <div className="flex justify-center">
            <button onClick={loadMoreRuns} disabled={runsBusy} className="btn-ghost px-4">{runsBusy ? '加载中…' : '加载更多'}</button>
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/40 p-4" onClick={closeForm}>
          <div className="card w-full max-w-2xl space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{editing === 'new' ? '新建工具' : '编辑工具'}</h3>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">名称</span>
                <input className="field" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="如 一键去水印" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">价格（积分）</span>
                <input className="field num" inputMode="numeric" value={form.priceCredits}
                  onChange={(e) => setForm((f) => ({ ...f, priceCredits: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-ink3">描述</span>
              <input className="field" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="给学员看的一句话说明" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">workflowId</span>
                <input className="field" value={form.workflowId} onChange={(e) => setForm((f) => ({ ...f, workflowId: e.target.value }))} placeholder="扣子工作流 ID" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">排序（越小越靠前）</span>
                <input className="field num" inputMode="numeric" value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value.replace(/[^\d-]/g, '') }))} />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
              上架（学员可见可用）
            </label>

            <div className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="eyebrow">输入项</p>
                <div className="flex items-center gap-2">
                  <button onClick={fetchParams} disabled={fetchBusy} className="btn-quiet text-xs">
                    {fetchBusy ? '拉取中…' : '从扣子拉取参数'}
                  </button>
                  <button onClick={probeParams} disabled={probeBusy} className="btn-quiet text-xs">
                    {probeBusy ? '探测中…' : '自动探测'}
                  </button>
                </div>
              </div>
              {fetchHint && <p className="pill">{fetchHint}</p>}
              {fetchErr && <p className="pill pill-bad">{fetchErr}</p>}
              {probeWarning && <p className="pill pill-warn">{probeWarning}</p>}
              {probeErr && <p className="pill pill-bad">{probeErr}</p>}

              <div className="space-y-2">
                {form.inputs.map((inp, i) => (
                  <div key={i} className="grid grid-cols-12 items-start gap-2 rounded-lg bg-surface2 p-2">
                    <input className="field col-span-3" value={inp.name} placeholder="参数名"
                      onChange={(e) => updateInput(i, { name: e.target.value })} />
                    <input className="field col-span-3" value={inp.label} placeholder="中文标签"
                      onChange={(e) => updateInput(i, { label: e.target.value })} />
                    <select className="field col-span-2" value={inp.type}
                      onChange={(e) => updateInput(i, { type: e.target.value as CozeInputType })}>
                      {INPUT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                    </select>
                    <label className="col-span-1 flex items-center justify-center gap-1 text-xs">
                      <input type="checkbox" checked={inp.required} onChange={(e) => updateInput(i, { required: e.target.checked })} />
                      必填
                    </label>
                    <input className="field col-span-2" value={inp.placeholder ?? ''} placeholder="占位提示"
                      onChange={(e) => updateInput(i, { placeholder: e.target.value })} />
                    <button onClick={() => removeInput(i)} className="col-span-1 text-xs text-bad">删除</button>
                    {inp.type === 'select' && (
                      <input className="field col-span-11" value={inp.optionsText} placeholder="选项，逗号分隔，如 A,B,C"
                        onChange={(e) => updateInput(i, { optionsText: e.target.value })}
                        onBlur={(e) => updateInput(i, { optionsText: parseOptions(e.target.value).join(',') })} />
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addInput} className="btn-ghost text-xs">＋ 添加输入项</button>
            </div>

            {formErr && <p className="pill pill-bad">{formErr}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={closeForm} className="btn-ghost px-4">取消</button>
              <button onClick={save} disabled={formBusy} className="btn-primary px-5">{formBusy ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
