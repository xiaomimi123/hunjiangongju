'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
// 直接从子模块导入（而非 '@mixcut/db' 包索引）：包索引会连带引入 bullmq/ioredis 等仅限服务端的
// 依赖，被 'use client' 组件打包进浏览器 bundle 会构建失败（Can't resolve 'net'/'fs' 等）。
import { TTS_VOICES, type TtsVoice } from '@mixcut/db/src/ai/ttsVoices'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'
import { GenPill } from './genStatus'
import { effStatus } from '@/lib/effStatus'

type Framework = { id: string; name: string | null; industryCategory: string | null; visualStyleType: string; createdAt: string; defaultAssetFolder: string | null }
type Creator = { nickname: string | null; email: string; role: string }
type GenTask = { id: string; subject: string; status: string; createdAt: string; updatedAt: string; framework: { name: string | null } | null; creator?: Creator | null; renderTasks?: { status: string }[] }
type BookRow = { title: string; author: string; points: string }
type Mode = 'subject' | 'books'
type Voice = { id: string; voiceId: string; name: string }
type ScriptMode = 'auto' | 'manual' | 'imitate'
type AssetSource = 'ai' | 'library'
type AssetsResp = { folders: string[] }

const ASSET_SOURCE_OPTIONS: { value: AssetSource; label: string }[] = [
  { value: 'ai', label: 'AI 生图' },
  { value: 'library', label: '素材库优先' },
]

const SCRIPT_MODE_OPTIONS: { value: ScriptMode; label: string }[] = [
  { value: 'auto', label: '自动生成' },
  { value: 'manual', label: '手动粘贴' },
  { value: 'imitate', label: '参考仿写' },
]
const CUSTOM_SCRIPT_PLACEHOLDER: Record<'manual' | 'imitate', string> = {
  manual: '粘贴你的文案，按句号/换行自动分句',
  imitate: '粘贴参考文案，AI 照风格仿写',
}

const EMPTY_BOOK_ROW: BookRow = { title: '', author: '', points: '' }

export default function GeneratePage() {
  const router = useRouter()
  const [tasks, setTasks] = useState<GenTask[] | null>(null)
  const [err, setErr] = useState('')

  const [open, setOpen] = useState(false)
  const [frameworks, setFrameworks] = useState<Framework[]>([])
  const [frameworkId, setFrameworkId] = useState('')
  const [subject, setSubject] = useState('')
  const [variables, setVariables] = useState('')
  const [mode, setMode] = useState<Mode>('subject')
  const [books, setBooks] = useState<BookRow[]>([{ ...EMPTY_BOOK_ROW }])
  const [modalErr, setModalErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceId, setVoiceId] = useState('')
  const [scriptMode, setScriptMode] = useState<ScriptMode>('auto')
  const [customScript, setCustomScript] = useState('')
  const [bookTitle, setBookTitle] = useState('')
  const [voice, setVoice] = useState('')
  const [previewingVoice, setPreviewingVoice] = useState('')
  const [previewErr, setPreviewErr] = useState('')
  const [assetSource, setAssetSource] = useState<AssetSource>('ai')
  const [assetFolder, setAssetFolder] = useState('')
  const [assetFolders, setAssetFolders] = useState<string[]>([])
  const [ttsVoices, setTtsVoices] = useState<TtsVoice[]>(TTS_VOICES)

  const load = useCallback(async () => {
    try { setTasks(await api<GenTask[]>('/api/generate')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])
  // 音色下拉：内置清单先兜底展示，拉取成功后换成「内置 + DB customVoices」合并清单；拉取失败保持内置兜底。
  useEffect(() => {
    api<{ voices: TtsVoice[] }>('/api/tts/voices').then((r) => setTtsVoices(r.voices)).catch(() => {})
  }, [])

  const [deleting, setDeleting] = useState('')
  async function del(id: string, subject: string) {
    if (!confirm(`确定删除「${subject}」？将一并删除其分镜与成片文件，不可恢复。`)) return
    setDeleting(id)
    try { await api(`/api/generate/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setErr((e as Error).message) }
    finally { setDeleting('') }
  }

  // 剪映导入的框架自动预填「素材库优先 + 原工程文件夹」;运营可手动改回 AI。
  // 供 openModal 的初始选中框架、以及 select onChange 切换框架时共用。
  function applyFrameworkPrefill(fw: Framework | undefined) {
    if (fw?.defaultAssetFolder) { setAssetSource('library'); setAssetFolder(fw.defaultAssetFolder) }
    else { setAssetSource('ai'); setAssetFolder('') }
  }

  function openModal() {
    setModalErr(''); setSubject(''); setVariables(''); setFrameworkId('')
    setMode('subject'); setBooks([{ ...EMPTY_BOOK_ROW }]); setVoiceId('')
    setScriptMode('auto'); setCustomScript(''); setBookTitle('')
    setVoice(''); setPreviewingVoice(''); setPreviewErr('')
    setAssetSource('ai'); setAssetFolder('')
    setOpen(true)
    api<Framework[]>('/api/frameworks').then((fw) => {
      setFrameworks(fw)
      if (fw[0]) { setFrameworkId(fw[0].id); applyFrameworkPrefill(fw[0]) }
    }).catch((e) => setModalErr((e as Error).message))
    api<Voice[]>('/api/admin/voices').then(setVoices).catch(() => setVoices([]))
    api<AssetsResp>('/api/admin/assets').then((r) => setAssetFolders(r.folders)).catch(() => setAssetFolders([]))
  }

  function updateBook(i: number, field: keyof BookRow, value: string) {
    setBooks((prev) => prev.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)))
  }
  function addBook() {
    setBooks((prev) => [...prev, { ...EMPTY_BOOK_ROW }])
  }
  function removeBook(i: number) {
    setBooks((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))
  }

  async function previewVoice(id: string) {
    if (previewingVoice) return
    setPreviewErr('')
    setPreviewingVoice(id)
    try {
      const res = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `试听失败(${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => { setPreviewingVoice(''); URL.revokeObjectURL(url) }
      audio.onerror = () => { setPreviewingVoice(''); URL.revokeObjectURL(url) }
      await audio.play()
    } catch (e) {
      setPreviewErr((e as Error).message)
      setPreviewingVoice('')
    }
  }

  async function submit() {
    setModalErr('')
    if (!frameworkId) { setModalErr('请选择框架'); return }
    if (scriptMode === 'auto' && !subject.trim()) { setModalErr('请填写选题'); return }
    let vars: Record<string, unknown> | undefined
    if (mode === 'books') {
      const cleaned = books
        .map((b) => ({ title: b.title.trim(), author: b.author.trim(), points: b.points.trim() }))
        .filter((b) => b.title)
        .map((b) => ({ title: b.title, ...(b.author ? { author: b.author } : {}), ...(b.points ? { points: b.points } : {}) }))
      if (cleaned.length === 0) { setModalErr('手填书单模式下，请至少填写一本书的书名'); return }
      vars = { books: cleaned }
    } else if (variables.trim()) {
      try { vars = JSON.parse(variables) }
      catch { setModalErr('变量需为合法 JSON（如 {"标题":"测试书"}）'); return }
    }
    if (voiceId) vars = { ...(vars ?? {}), voiceId }
    if (scriptMode !== 'auto') vars = { ...(vars ?? {}), scriptMode, customScript }
    if (bookTitle.trim()) vars = { ...(vars ?? {}), bookTitle: bookTitle.trim() }
    if (voice) vars = { ...(vars ?? {}), voice }
    if (assetSource === 'library') vars = { ...(vars ?? {}), assetSource, ...(assetFolder ? { assetFolder } : {}) }
    setBusy(true)
    try {
      const r = await api<{ id: string }>('/api/generate', { body: { frameworkId, subject: subject.trim(), variables: vars } })
      router.push(`/admin/generate/${r.id}`)
    } catch (e) { setModalErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="生成" subtitle="按框架发起 AI 书单号生成，跟踪流水线进度">
        <button onClick={openModal} className="btn-primary">发起生成</button>
      </PageHeader>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card overflow-x-auto">
        {tasks && tasks.length >= 200 && (
          <p className="border-b border-line px-4 py-2 text-xs text-ink3">仅显示最近 200 条生成任务</p>
        )}
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">选题</th>
              <th className="px-4 py-3 font-medium">框架</th>
              <th className="px-4 py-3 font-medium">创建人</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tasks?.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-surface2" onClick={() => router.push(`/admin/generate/${t.id}`)}>
                <td className="px-4 py-3">
                  <Link href={`/admin/generate/${t.id}`} className="font-medium text-flame">{t.subject}</Link>
                </td>
                <td className="px-4 py-3 text-ink2">{t.framework?.name ?? '—'}</td>
                <td className="px-4 py-3 text-ink2">
                  {t.creator
                    ? <span title={t.creator.email}>{t.creator.nickname || t.creator.email}{t.creator.role === 'student' && <span className="ml-1 text-ink3">(学员)</span>}</span>
                    : <span className="text-ink3">—</span>}
                </td>
                {/* 有效状态：渲染排队后 genTask.status 停在 VISUAL_RENDERING 不再前进，
                    真实进度在最新 RenderTask 上（effStatus 的老坑，第四个页面也中过） */}
                <td className="px-4 py-3"><GenPill status={effStatus({ status: t.status, renderTasks: t.renderTasks ?? [] })} /></td>
                <td className="num px-4 py-3 text-ink3">{new Date(t.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => del(t.id, t.subject)} disabled={deleting === t.id}
                    className="text-ink3 hover:text-flame disabled:opacity-50">
                    {deleting === t.id ? '删除中…' : '删除'}
                  </button>
                </td>
              </tr>
            ))}
            {tasks && tasks.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink3">暂无生成任务，点击右上角「发起生成」</td></tr>
            )}
            {!tasks && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink3">加载中…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="发起生成" wide>
        <div className="space-y-4">
          <label className="block">
            <span className="eyebrow">框架</span>
            <select className="field mt-1" value={frameworkId} onChange={(e) => {
              const id = e.target.value
              setFrameworkId(id)
              applyFrameworkPrefill(frameworks.find((f) => f.id === id))
            }}>
              {frameworks.length === 0 && <option value="">（暂无框架）</option>}
              {frameworks.map((f) => (
                <option key={f.id} value={f.id}>{f.name ?? f.id.slice(0, 8)}{f.industryCategory ? `（${f.industryCategory}）` : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="eyebrow">选题{scriptMode !== 'auto' ? '（可选，留空则由文案自动推断）' : ''}</span>
            <input className="field mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="例：活下去的理由" autoFocus />
          </label>
          <div className="block">
            <span className="eyebrow">文案来源</span>
            <div className="mt-1 flex gap-2">
              {SCRIPT_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setScriptMode(opt.value)}
                  className={scriptMode === opt.value ? 'btn-primary px-4 py-1.5 text-sm' : 'btn-ghost px-4 py-1.5 text-sm'}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {scriptMode !== 'auto' && (
            <label className="block">
              <span className="eyebrow">{scriptMode === 'manual' ? '手动文案' : '参考文案'}</span>
              <textarea
                className="field mt-1"
                rows={5}
                value={customScript}
                onChange={(e) => setCustomScript(e.target.value)}
                placeholder={CUSTOM_SCRIPT_PLACEHOLDER[scriptMode]}
              />
            </label>
          )}

          <label className="block">
            <span className="eyebrow">书名标题（可选）</span>
            <input className="field mt-1" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="例：活着" />
          </label>

          <label className="block">
            <span className="eyebrow">音色（可选，不选则用通用音色）</span>
            <select className="field mt-1" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              <option value="">通用音色</option>
              {voices.map((v) => (
                <option key={v.id} value={v.voiceId}>{v.name}</option>
              ))}
            </select>
          </label>

          <div className="block">
            <span className="eyebrow">配音音色（可选，不选则用系统默认音色）</span>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setVoice('')}
                className={voice === '' ? 'btn-primary px-4 py-1.5 text-sm' : 'btn-ghost px-4 py-1.5 text-sm'}
              >
                系统默认
              </button>
              {ttsVoices.map((v) => (
                <div key={v.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setVoice(v.id)}
                    className={voice === v.id ? 'btn-primary px-4 py-1.5 text-sm' : 'btn-ghost px-4 py-1.5 text-sm'}
                  >
                    {v.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => previewVoice(v.id)}
                    disabled={!!previewingVoice}
                    className="btn-ghost px-2 py-1.5 text-xs disabled:opacity-40"
                  >
                    {previewingVoice === v.id ? '播放中…' : '试听'}
                  </button>
                </div>
              ))}
            </div>
            {previewErr && <p className="pill pill-bad mt-1">{previewErr}</p>}
          </div>

          <div className="block">
            <span className="eyebrow">配图来源</span>
            <div className="mt-1 flex gap-2">
              {ASSET_SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAssetSource(opt.value)}
                  className={assetSource === opt.value ? 'btn-primary px-4 py-1.5 text-sm' : 'btn-ghost px-4 py-1.5 text-sm'}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {assetSource === 'library' && (
              <select className="field mt-2" value={assetFolder} onChange={(e) => setAssetFolder(e.target.value)}>
                <option value="">不限文件夹（全部素材）</option>
                {assetFolders.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            )}
          </div>

          <div className="block">
            <span className="eyebrow">生成模式</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setMode('subject')}
                className={mode === 'subject' ? 'btn-primary px-4 py-1.5 text-sm' : 'btn-ghost px-4 py-1.5 text-sm'}
              >
                选题自选（LLM 自己选书）
              </button>
              <button
                type="button"
                onClick={() => setMode('books')}
                className={mode === 'books' ? 'btn-primary px-4 py-1.5 text-sm' : 'btn-ghost px-4 py-1.5 text-sm'}
              >
                手填书单
              </button>
            </div>
          </div>

          {mode === 'books' ? (
            <div className="block space-y-2">
              <span className="eyebrow">书单（书名 / 作者 / 要点，逐本填写）</span>
              <div className="space-y-2">
                {books.map((b, i) => (
                  <div key={i} className="grid grid-cols-[1.1fr_0.9fr_1.3fr_auto] gap-2">
                    <input className="field" placeholder="书名（必填）" value={b.title} onChange={(e) => updateBook(i, 'title', e.target.value)} />
                    <input className="field" placeholder="作者（可选）" value={b.author} onChange={(e) => updateBook(i, 'author', e.target.value)} />
                    <input className="field" placeholder="要点（可选）" value={b.points} onChange={(e) => updateBook(i, 'points', e.target.value)} />
                    <button
                      type="button"
                      onClick={() => removeBook(i)}
                      disabled={books.length === 1}
                      className="btn-ghost px-2 text-xs disabled:opacity-40"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addBook} className="btn-ghost px-3 py-1 text-xs">+ 添加一本书</button>
            </div>
          ) : (
            <label className="block">
              <span className="eyebrow">变量（可选，JSON）</span>
              <textarea className="field mt-1 font-mono text-xs" rows={3} value={variables} onChange={(e) => setVariables(e.target.value)} placeholder='{"标题":"测试书","账号":"@测试"}' />
            </label>
          )}

          {modalErr && <p className="pill pill-bad">{modalErr}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} disabled={busy} className="btn-ghost px-4">取消</button>
            <button onClick={submit} disabled={busy} className="btn-primary px-5">{busy ? '发起中…' : '发起'}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
