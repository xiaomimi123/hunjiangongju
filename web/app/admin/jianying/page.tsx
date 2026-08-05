'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

// 内置字体集合（与 packages/db/src/booklist/parseJianyingDraft.ts 的 FONT_FAMILY_MAP 保持一致）。
const BUILTIN_FONTS = ['字由玄真', '三极极宋 超粗新', '莫雪体']

// 以下类型与 packages/db/src/booklist/{draftStructure,templateParams,parseJianyingDraft}.ts 的导出保持一致——
// 本页是客户端组件，不能 import @mixcut/db（会带入 Prisma/服务端代码），故在此镜像声明。
type DraftStructure = {
  openDurationMs: number
  flashCount: number
  flashPerClipMs: number
  flashMinClipMs: number
  bodyCount: number
  bodyAvgMs: number
  flashScale: number
  bodyScale: number
  segments: { index: number; role: 'open' | 'flash' | 'body'; durationMs: number; scale: number; materialType?: string }[]
}

type DraftMeta = {
  canvas: { width: number; height: number }
  durationMs: number
  segmentCount: number
  fontsNeeded: string[]
  bookTitles: string[]
  warnings: string[]
  watermark?: string
  structure: DraftStructure
}

type GradeParams = { filterName: string; intensity: number; contrast: number; sharpen: boolean }

type TP = {
  mode: 'classic' | 'flash'
  open: { durationMs: number; shatter: boolean; titleText: string; sfx: boolean }
  flash: { perClipMs: number; minClipMs: number; bounceIn: boolean; titleFontFamily: string; scale?: number }
  transition: { type: 'dissolve'; durationMs: number }
  body: { subtitleFontFamily: string; subtitleColor: string; subtitlePosY: number; kenBurns: 'subtle' | 'off'; photoScale?: number; subtitleEntrance?: string }
  audio: { bgmVolume: number; sfx: { openGear: boolean; transitionDrop: boolean } }
  grade?: GradeParams
  motion?: { moves: string[] }
}

type Media = { bgm: { fileName: string; title: string }[]; images: string[] }

type Row = { icon: '✓' | '⚠' | '✗'; label: string; text: string }

// 新版剪映(约 6.5+，含 iOS 19.x)加密 draft_content.json（密文不以 { 开头）。
// 同工程的 Timelines/<id>/template.json 是等价明文时间线，自动回退到它。
async function readDraftText(files: File[], draftFile: File): Promise<string> {
  const head = await draftFile.slice(0, 1).text()
  if (head === '{') return draftFile.text()
  const plain = files.find((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
    return f.name === 'template.json' && rel.includes('/Timelines/')
  })
  if (!plain) throw new Error('这个剪映工程是加密的，且没找到可用的明文时间线（Timelines/*/template.json）')
  return plain.text()
}

export default function JianyingTemplatePage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseErr, setParseErr] = useState('')
  const [meta, setMeta] = useState<DraftMeta | null>(null)
  const [templateParams, setTemplateParams] = useState<TP | null>(null)

  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [savedId, setSavedId] = useState('')

  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [projectName, setProjectName] = useState('')
  const [media, setMedia] = useState<Media | null>(null)
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState('')
  const [importResult, setImportResult] = useState<{ id: string; bgm: { imported: number; reused: number }; assets: { imported: number; reused: number } } | null>(null)

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setRaw(text)
  }

  async function onFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setFolderFiles(files)
    setImportResult(null)
    const draftFile = files.find((f) => f.name === 'draft_content.json')
    if (!draftFile) {
      setParseErr('这不是剪映工程文件夹（未找到 draft_content.json）')
      setMeta(null)
      setTemplateParams(null)
      setMedia(null)
      setSavedId('')
      return
    }
    const proj = (draftFile as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] || '剪映工程'
    setProjectName(proj)
    if (!name.trim()) setName(proj)
    let text: string
    try {
      text = await readDraftText(files, draftFile)
    } catch (e) {
      setParseErr((e as Error).message)
      setMeta(null)
      setTemplateParams(null)
      setMedia(null)
      setSavedId('')
      return
    }
    setRaw(text)
    await parse(text) // parse 改为可接收显式文本参数,避免 setState 异步竞态
  }

  async function parse(rawText?: string) {
    const src = rawText ?? raw
    setParseErr('')
    setMeta(null)
    setTemplateParams(null)
    setSavedId('')
    setMedia(null)
    if (!src.trim()) { setParseErr('请上传 draft_content.json 或粘贴其内容'); return }
    let draftJson: unknown = src
    try { draftJson = JSON.parse(src) } catch { /* 交给后端按字符串再尝试解析并报错 */ }
    setParsing(true)
    try {
      const r = await api<{ templateParams: TP; meta: DraftMeta; media?: Media }>('/api/admin/jianying/parse', { body: { draftJson } })
      setTemplateParams(r.templateParams)
      setMeta(r.meta)
      setMedia(r.media ?? null)
    } catch (e) { setParseErr((e as Error).message) }
    finally { setParsing(false) }
  }

  async function importAll() {
    if (!templateParams || !media) return
    if (!name.trim()) { setImportErr('请填写框架名'); return }
    setImportErr(''); setImporting(true)
    try {
      const byName = new Map(folderFiles.map((f) => [f.name, f]))
      const form = new FormData()
      form.set('name', name.trim())
      form.set('projectName', projectName || '剪映工程')
      form.set('templateParams', JSON.stringify(templateParams))
      if (meta?.watermark) form.set('watermark', meta.watermark)
      if (meta?.structure?.bodyCount) form.set('bodyCount', String(meta.structure.bodyCount))
      const foundBgm = media.bgm.filter((b) => byName.has(b.fileName))
      form.set('bgmMeta', JSON.stringify(foundBgm))
      for (const b of foundBgm) form.append('bgmFiles', byName.get(b.fileName)!)
      for (const img of media.images) { const f = byName.get(img); if (f) form.append('imageFiles', f) }
      const missing = [...media.bgm.map((b) => b.fileName), ...media.images].filter((n) => !byName.has(n))
      const r = await fetch('/api/admin/jianying/import', { method: 'POST', body: form })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `导入失败(${r.status})`)
      const j = await r.json()
      setImportResult(j)
      if (missing.length > 0) setImportErr(`已导入,但 ${missing.length} 个媒体文件在文件夹中未找到,已跳过: ${missing.join('、')}`)
    } catch (e) { setImportErr((e as Error).message) }
    finally { setImporting(false) }
  }

  async function save() {
    setSaveErr('')
    setSavedId('')
    if (!templateParams) { setSaveErr('请先解析预览'); return }
    if (!name.trim()) { setSaveErr('请填写框架名'); return }
    setSaving(true)
    try {
      const r = await api<{ id: string }>('/api/admin/jianying/save', { body: { name: name.trim(), templateParams } })
      setSavedId(r.id)
    } catch (e) { setSaveErr((e as Error).message) }
    finally { setSaving(false) }
  }

  // 把结构/参数提取结果译成人话——只说渲染器实际会做的事，缺失的一律标「未识别到」或省略,绝不拿默认值充数。
  function buildReport(meta: DraftMeta, tp: TP): Row[] {
    const rows: Row[] = []
    const st = meta.structure
    if (st && st.bodyCount > 0) {
      rows.push({ icon: '✓', label: '结构', text: `开场 ${(st.openDurationMs / 1000).toFixed(1)}s · 快闪 ${st.flashCount} 张 @${st.flashMinClipMs}–${Math.max(st.flashMinClipMs, st.flashPerClipMs)}ms · 正片 ${st.bodyCount} 段（平均 ${(st.bodyAvgMs / 1000).toFixed(1)}s）` })
    }
    rows.push({ icon: '✓', label: '转场', text: `叠化 ${tp.transition.durationMs}ms` })
    // 曲名来自 parse 响应的 media.bgm[0].title（templateParams 只有音量）
    const song = media?.bgm?.[0]?.title
    rows.push({ icon: '✓', label: '配乐', text: `${song ? `《${song}》 ` : ''}音量 ${tp.audio.bgmVolume.toFixed(2)}` })
    const sfx: string[] = []
    if (tp.audio.sfx.openGear) sfx.push('开场音效')
    if (tp.audio.sfx.transitionDrop) sfx.push('转场水滴')
    if (sfx.length) rows.push({ icon: '✓', label: '音效', text: sfx.join('、') })
    if (meta.watermark) rows.push({ icon: '✓', label: '水印', text: meta.watermark })
    if (tp.grade) {
      const known = tp.grade.filterName === '青橙'
      rows.push({
        icon: known || !tp.grade.filterName ? '✓' : '⚠',
        label: '调色',
        text: `${tp.grade.filterName || '仅对比度'} 强度 ${tp.grade.intensity.toFixed(2)} · 对比度 ${tp.grade.contrast.toFixed(2)}`
          + (known || !tp.grade.filterName ? '' : '（该滤镜未内置，仅按对比度近似）')
          + (tp.grade.sharpen ? ' · 锐化（无法复刻）' : ''),
      })
    }
    if (tp.motion?.moves?.length) rows.push({ icon: '✓', label: '运镜', text: `${tp.motion.moves.length} 段有关键帧运镜，按顺序循环套用` })
    if (tp.body.subtitleEntrance) rows.push({ icon: '✓', label: '字幕入场', text: tp.body.subtitleEntrance })
    return rows
  }

  return (
    <div className="space-y-5">
      <PageHeader title="剪映模板" subtitle="选择剪映工程文件夹，自动提取快闪配方、BGM 与素材并保存为框架" />

      <div className="card space-y-4 p-6">
        <label className="block">
          <span className="eyebrow">选择剪映工程文件夹（推荐）</span>
          <input
            ref={folderInputRef}
            type="file"
            onChange={onFolderChange}
            className="field mt-1"
          />
          {folderFiles.length > 0 && (
            <p className="mt-1 text-xs text-ink3">已选择 {folderFiles.length} 个文件{projectName && ` · 工程名：${projectName}`}</p>
          )}
        </label>

        <div className="border-t border-line pt-4">
          <label className="block">
            <span className="eyebrow">或单独上传 draft_content.json</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={onFileChange}
              className="field mt-1"
            />
          </label>

          <label className="mt-3 block">
            <span className="eyebrow">或粘贴 JSON 文本</span>
            <textarea
              className="field mt-1 font-mono text-xs"
              rows={8}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="粘贴 draft_content.json 的完整内容"
            />
          </label>

          {parseErr && <p className="pill pill-bad mt-2">{parseErr}</p>}

          <div className="mt-3 flex justify-end">
            <button onClick={() => parse()} disabled={parsing} className="btn-primary px-5">
              {parsing ? '解析中…' : '解析预览'}
            </button>
          </div>
        </div>
      </div>

      {meta && (
        <div className="card space-y-4 p-6">
          <h3 className="font-display text-lg font-bold">解析预览</h3>

          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="eyebrow">画布</p>
              <p className="num mt-1">{meta.canvas.width} × {meta.canvas.height}</p>
            </div>
            <div>
              <p className="eyebrow">时长</p>
              <p className="num mt-1">{(meta.durationMs / 1000).toFixed(1)} 秒</p>
            </div>
            <div>
              <p className="eyebrow">分镜数</p>
              <p className="num mt-1">{meta.segmentCount}</p>
            </div>
            <div>
              <p className="eyebrow">识别到的书名</p>
              <p className="mt-1">{meta.bookTitles.length > 0 ? meta.bookTitles.join('、') : '—'}</p>
            </div>
          </div>

          {templateParams && (
            <div>
              <p className="eyebrow">识别结果</p>
              <ul className="mt-1 space-y-1 text-sm">
                {buildReport(meta, templateParams).map((row, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`pill ${row.icon === '✓' ? 'pill-ok' : row.icon === '⚠' ? 'pill-warn' : 'pill-bad'}`}>{row.icon}</span>
                    <span><b>{row.label}</b>：{row.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="eyebrow">需要的字体</p>
            {meta.fontsNeeded.length === 0 ? (
              <p className="mt-1 text-sm text-ink3">—</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {meta.fontsNeeded.map((f) => {
                  const builtin = BUILTIN_FONTS.includes(f)
                  return (
                    <li key={f} className="flex items-center gap-2">
                      <span>{f}</span>
                      {builtin ? (
                        <span className="pill pill-ok">内置</span>
                      ) : (
                        <span className="pill pill-warn">需上传字体文件</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-2"><span className="pill pill-bad">✗</span> <span className="text-sm text-ink3">装饰图层/剪映内置商用字体/艺术蒙版——超出模板能力，未复刻</span></p>
          </div>

          {meta.warnings.length > 0 && (
            <div>
              <p className="eyebrow">警告</p>
              <ul className="mt-1 space-y-1">
                {meta.warnings.map((w, i) => (
                  <li key={i} className="pill pill-warn">{w}</li>
                ))}
              </ul>
            </div>
          )}

          {media && (
            <div>
              <p className="eyebrow">工程内媒体</p>
              <p className="mt-1 text-sm">
                BGM {media.bgm.length} 首{media.bgm.length > 0 && `（${media.bgm.map((b) => b.title).join('、')}）`} · 图片 {media.images.length} 张
              </p>
            </div>
          )}

          <div className="border-t border-line pt-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="block flex-1">
                <span className="eyebrow">框架名</span>
                <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：活着快闪模板" />
              </label>
              {folderFiles.length > 0 && media && (
                <button
                  onClick={importAll}
                  disabled={importing || !templateParams || !name.trim()}
                  className="btn-primary px-5 disabled:opacity-50"
                >
                  {importing ? '导入中…' : '一键导入（含 BGM/素材）'}
                </button>
              )}
              <button
                onClick={save}
                disabled={saving || !templateParams || !name.trim()}
                className="btn-primary px-5 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存为框架'}
              </button>
            </div>
            {saveErr && <p className="pill pill-bad mt-2">{saveErr}</p>}
            {savedId && (
              <p className="pill pill-ok mt-2">
                已保存为框架（id: {savedId}）
                <Link href="/admin/frameworks" className="ml-2 underline">去框架库查看</Link>
              </p>
            )}
            {importErr && <p className="pill pill-bad mt-2">{importErr}</p>}
            {importResult && (
              <p className="pill pill-ok mt-2">
                已导入：框架创建 ✓ · BGM 入库 {importResult.bgm.imported} 首{importResult.bgm.reused > 0 && `（复用 ${importResult.bgm.reused}）`} · 素材入库 {importResult.assets.imported} 张{importResult.assets.reused > 0 && `（复用 ${importResult.assets.reused}）`}
                <Link href="/admin/frameworks" className="ml-2 underline">去框架库查看</Link>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
