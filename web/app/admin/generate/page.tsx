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
import { GEN_LABELS } from './genStatus'
import { effStatus } from '@/lib/effStatus'
import VideoCard from '@/components/VideoCard'

type Framework = { id: string; name: string | null; industryCategory: string | null; visualStyleType: string; createdAt: string; defaultAssetFolder: string | null }
type Creator = { nickname: string | null; email: string; role: string }
// renderTasks 需带上 videoUrl 才能在卡片海报里出首帧/给下载按钮取地址（/api/generate GET 已选取）
type GenTask = { id: string; subject: string; status: string; createdAt: string; updatedAt: string; framework: { name: string | null } | null; creator?: Creator | null; renderTasks?: { status: string; videoUrl: string | null }[] }

// 状态徽标色调：VideoCard 只认 ok/run/bad 三档，与 genStatus.tsx 内部私有的 genTone 分档一致，
// 但那个函数没导出（该文件按 brief 只允许改本文件），故本页照抄一份同口径的极简版，
// 学员端首页（web/app/(student)/page.tsx）也是这么各页面自带一份的老规矩。
function genTone(status: string): 'ok' | 'run' | 'bad' {
  if (status === 'EXPORTED' || status === 'QC_PASSED') return 'ok'
  if (status === 'FAILED' || status === 'QC_FAILED') return 'bad'
  return 'run'
}

// 卡片无成片时的渐变占位，循环取样稿色值（与学员端首页 POSTERS 同一批配色，保持视觉一致）
const POSTERS = [
  'bg-gradient-to-br from-[#2b2d42] to-[#8d99ae]',
  'bg-gradient-to-br from-[#5e3023] to-[#c08552]',
  'bg-gradient-to-br from-[#1d3557] to-[#457b9d]',
  'bg-gradient-to-br from-[#3a2d55] to-[#9b5de5]',
  'bg-gradient-to-br from-[#14342b] to-[#60935d]',
  'bg-gradient-to-br from-[#4a1c2e] to-[#b23a48]',
]

// 学员账号即 11 位手机号（email 列存手机号，见 phone-account-system 备忘），打码成 138****2210；
// 非该形态（如运营账号邮箱）原样展示，不臆造格式。
function maskPhone(v: string): string {
  return /^\d{11}$/.test(v) ? `${v.slice(0, 3)}****${v.slice(7)}` : v
}

function creatorLabel(c?: Creator | null): string {
  if (!c) return '—'
  if (c.role === 'student') return `学员 ${maskPhone(c.email)}`
  return c.nickname || c.email
}

// 相对时间：今天/昨天/前天/N天前，超过一个月退回日期，样稿（video-card-mockup.html「E·后台」）同款口径
function relTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays === 2) return '前天'
  if (diffDays < 30) return `${diffDays}天前`
  return d.toLocaleDateString('zh-CN')
}

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
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
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
    try {
      const d = await api<{ tasks: GenTask[]; nextCursor?: string }>('/api/generate')
      setTasks(d.tasks)
      setNextCursor(d.nextCursor ?? null)
    }
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

      {tasks && tasks.length >= 200 && (
        <p className="text-xs text-ink3">仅显示最近 200 条生成任务</p>
      )}

      {!tasks && <p className="py-10 text-center text-sm text-ink3">加载中…</p>}
      {tasks && tasks.length === 0 && (
        <p className="py-10 text-center text-sm text-ink3">暂无生成任务，点击右上角「发起生成」</p>
      )}

      {tasks && tasks.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {tasks.map((t, i) => {
            // 有效状态：渲染排队后 genTask.status 停在 VISUAL_RENDERING 不再前进，
            // 真实进度在最新 RenderTask 上（effStatus 的老坑，第四个页面也中过）
            const st = effStatus({ status: t.status, renderTasks: t.renderTasks ?? [] })
            const rt = t.renderTasks?.[0]
            return (
              <VideoCard
                key={t.id}
                src={rt?.videoUrl ?? null}
                title={t.subject}
                subtitle={creatorLabel(t.creator)}
                trailing={<span>{relTime(t.createdAt)}</span>}
                badge={{ text: GEN_LABELS[st] ?? st, tone: genTone(st) }}
                posterClassName={POSTERS[i % POSTERS.length]}
                onClick={() => router.push(`/admin/generate/${t.id}`)}
                footer={
                  <div className="mt-2 flex gap-1.5 border-t border-line pt-2" onClick={(e) => e.stopPropagation()}>
                    <Link href={`/admin/generate/${t.id}`} className="btn-ghost flex-1 px-2 text-xs">工作台</Link>
                    {rt?.videoUrl
                      ? <a href={rt.videoUrl} download className="btn-ghost flex-1 px-2 text-xs">下载</a>
                      : <span className="btn-ghost flex-1 px-2 text-xs opacity-40">下载</span>}
                    {/* 「重跑」在本页范围内无对应现成 handler（详情页的重渲/退回编辑各自有前置门禁，
                        不在列表这层暴露）；沿用列表原有的「删除」而非臆造一个假动作，见提交说明疑虑记录 */}
                    <button onClick={() => del(t.id, t.subject)} disabled={deleting === t.id}
                      className="btn-ghost flex-1 px-2 text-xs disabled:opacity-50">
                      {deleting === t.id ? '删除中…' : '删除'}
                    </button>
                  </div>
                }
              />
            )
          })}
        </div>
      )}

      {nextCursor && (
        <div className="text-center">
          <button className="btn-ghost text-xs" disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true)
              try {
                const d = await api<{ tasks: GenTask[]; nextCursor?: string }>(`/api/generate?cursor=${nextCursor}`)
                setTasks((prev) => [...(prev ?? []), ...d.tasks])
                setNextCursor(d.nextCursor ?? null)
              } catch (e) { setErr((e as Error).message) }
              finally { setLoadingMore(false) }
            }}>
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}

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
