'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'

// 与 packages/db/src/booklist/draftProvenance.ts 的导出保持一致（本页是客户端组件,不能 import @mixcut/db）。
type ProvenanceEntry = { path: string; status: 'extracted' | 'defaulted' | 'unsupported'; detail?: string }
type DraftFidelityReport = { parsedAt: string; summary: { extracted: number; defaulted: number; unsupported: number }; entries: ProvenanceEntry[] }

type FrameworkRow = { id: string; name: string | null; industryCategory: string | null; visualStyleType: string; published: boolean; degradedNote?: string | null; draftFidelityReport?: DraftFidelityReport | null; createdAt: string; imageSlotCount?: number | null }
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

// 把结构化保真度报告译成悬浮提示——只列 status!=extracted 且带 detail 的条目（extracted 条目
// 本身没有 detail，罗列它们没有信息量），detail 文案沿用解析器里已经写好的中文（见
// packages/db/src/booklist/parseJianyingDraft.ts 的 note() 调用），不再另起一套 path→标签映射表。
function fidelityTitle(r: DraftFidelityReport): string {
  const total = r.summary.extracted + r.summary.defaulted + r.summary.unsupported
  const lines = [
    '保真度报告（导入时快照，不随后续框架编辑更新）',
    `解析时间：${new Date(r.parsedAt).toLocaleString('zh-CN')}`,
    `已提取 ${r.summary.extracted} · 默认值兜底 ${r.summary.defaulted} · 明确未复刻 ${r.summary.unsupported}（共 ${total} 项）`,
  ]
  const details = r.entries.filter((e) => e.status !== 'extracted' && e.detail)
  if (details.length > 0) {
    lines.push('——')
    for (const e of details) lines.push(`· ${e.detail}`)
  }
  return lines.join('\n')
}

const STYLE_PRESETS = [
  { label: '厚涂油画', v: '厚涂油画质感,浓郁色彩,可见笔触,古典书卷氛围,无人物,静物/自然/动物' },
  { label: '梵高风', v: '梵高后印象派风格,旋转笔触,厚重颜料肌理,鲜明蓝黄对比,星夜质感,无人物' },
  { label: '治愈插画', v: '极简性冷淡治愈系艺术插画,动物自然静物,留白构图,无人物' },
  // 达芬奇的代表作多是人物画,不加「无人物」——负向提示词也已不再硬禁人物
  { label: '达芬奇', v: '达芬奇文艺复兴油画风格,晕涂法柔和过渡,明暗对照,大地色调,古典构图' },
  // 开场那张人物特写头像用;必须显式点名人物,否则画风提示词会把它带偏成风景
  { label: '日系卡通头像', v: '日系动漫赛璐璐画风,少年人物面部特写,清透大眼,柔和高光,浅色调,干净背景' },
]

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
                  {f.imageSlotCount == null && (
                    <span
                      title="该框架缺少图片槽位等参数，多半不是走「一键导入」建的。用它生成时逐槽配置不会生效，建议重新导入工程文件夹。"
                      className="ml-2 cursor-help rounded bg-rose-500/15 px-1.5 py-0.5 text-xs text-rose-600"
                    >
                      ⚠️ 无图片槽位
                    </span>
                  )}
                  {f.degradedNote && (
                    <span title={f.degradedNote} className="ml-2 cursor-help rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-600">
                      ⚠️ 降级
                    </span>
                  )}
                  {f.draftFidelityReport && (
                    <span
                      title={fidelityTitle(f.draftFidelityReport)}
                      className="ml-2 cursor-help rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-600"
                    >
                      保真度 {f.draftFidelityReport.summary.extracted}/{f.draftFidelityReport.summary.extracted + f.draftFidelityReport.summary.defaulted + f.draftFidelityReport.summary.unsupported}
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
              <div className="mt-1 flex gap-2">
                {STYLE_PRESETS.map((p) => (
                  <button key={p.label} type="button" className="btn-ghost text-xs" onClick={() => setF({ imageStylePrompt: p.v })}>
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea className="field mt-1 text-xs" rows={3} value={form.imageStylePrompt} onChange={(e) => setF({ imageStylePrompt: e.target.value })} />
            </label>
            <label className="block">
              <span className="eyebrow">叠加模板（JSON）</span>
              <textarea className="field mt-1 font-mono text-xs" rows={4} value={form.overlayTemplate} onChange={(e) => setF({ overlayTemplate: e.target.value })} placeholder='{"title_card":"{{标题}} {{副标题}}","watermark":"{{账号}}"}' />
            </label>

            {/* 图片槽位：直接编辑 overlayTemplate 里的 __imageSlots，改完写回同一个 JSON 字符串。
                不另存一份 state——两处各存一份必然漂移，运营在 JSON 里改了这里不刷新、
                或反过来，都会让人以为配置没生效。 */}
            {(() => {
              let ot: Record<string, unknown> = {}
              try { ot = form.overlayTemplate.trim() ? JSON.parse(form.overlayTemplate) : {} } catch { return null }
              const cfg = ot.__imageSlots as { count?: number; slots?: unknown[] } | undefined
              const count = typeof cfg?.count === 'number' ? cfg.count : 0
              if (count <= 0) return null
              const slots = Array.isArray(cfg?.slots) ? (cfg!.slots as Record<string, unknown>[]) : []
              const at = (i: number) => slots.find((x) => x.index === i) ?? { index: i, source: 'ai' as const }
              const write = (i: number, patch: Record<string, unknown>) => {
                const next = slots.filter((x) => x.index !== i)
                const merged = { ...at(i), ...patch }
                // 清掉空串,避免写出 {"prompt":""} 这种噪音
                for (const k of ['prompt', 'folder', 'style']) {
                  if (typeof merged[k] === 'string' && !(merged[k] as string).trim()) delete merged[k]
                }
                next.push(merged)
                next.sort((a, b) => (a.index as number) - (b.index as number))
                setF({ overlayTemplate: JSON.stringify({ ...ot, __imageSlots: { count, slots: next } }, null, 2) })
              }
              return (
                <div className="block">
                  <span className="eyebrow">图片槽位（{count} 张正片配图）</span>
                  <p className="mt-1 text-xs text-ink3">
                    提示词只写「画什么」。画风默认取上面的「图片风格提示词」，改一次全部槽位生效；
                    个别槽位要不同画风（例如开场用卡通人物头像、后面用达芬奇），在该槽位单独填「画风」覆盖。
                  </p>
                  <div className="mt-2 space-y-2">
                    {Array.from({ length: count }, (_, i) => {
                      const sl = at(i) as { source?: string; prompt?: string; folder?: string; style?: string }
                      const isAi = sl.source !== 'library'
                      return (
                        <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-line px-2 py-2">
                          <span className="w-12 shrink-0 text-xs text-ink3">第 {i + 1} 张</span>
                          <select
                            className="field w-28 shrink-0 text-xs"
                            value={isAi ? 'ai' : 'library'}
                            onChange={(e) => write(i, { source: e.target.value })}
                          >
                            <option value="ai">AI 生图</option>
                            <option value="library">素材库</option>
                          </select>
                          {isAi ? (
                            <>
                              <input
                                className="field flex-1 text-xs"
                                value={sl.prompt ?? ''}
                                onChange={(e) => write(i, { prompt: e.target.value })}
                                placeholder="画什么（留空则用内置场景池随机）"
                              />
                              <input
                                className="field flex-1 text-xs"
                                value={sl.style ?? ''}
                                onChange={(e) => write(i, { style: e.target.value })}
                                placeholder="画风（留空 = 用上面的全局画风）"
                              />
                            </>
                          ) : (
                            <input
                              className="field flex-1 text-xs"
                              value={sl.folder ?? ''}
                              onChange={(e) => write(i, { folder: e.target.value })}
                              placeholder="素材文件夹（留空 = 全库随机）"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
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
