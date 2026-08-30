'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import {
  SlotRows, TransitionRows, MotionRows, CaptionStyleRows, AudioRows, TextRows, PaceRows,
  type Cycle, type Keyframe, type AudioParams, type TextParams, type PaceParams, type FontOption,
} from '@/components/admin/paramControls'
import { StageCanvas, type StageScene, type StageLayer, type StageBg, type StageSample } from '@/components/admin/StageCanvas'
import { thumbUrl } from '@/lib/thumbUrl'
// 子模块路径导入（非 '@mixcut/db' 包索引）：见 stageGeometry.ts 顶部注释，走包索引会把
// bullmq/ioredis 拖进浏览器 bundle 导致整页白屏。
import { BODY_SIZE } from '@mixcut/db/src/booklist/bodySize'

// 剪辑工作台：调这一条片子的节奏、字幕样式、配乐，然后重渲。
//
// 只暴露**渲染层真的会读**的参数。契约里另有一批「草稿解析出来了但渲染器不读」的字段
//（kenBurns / photoScale / subtitleEntrance / subtitleFontFamily / flash.scale /
// grade.filterName / motion.moves / enterBodyHardCut 等，均已逐个 grep 核实），
// 做成控件就是让人调空气——界面改了、保存成功了、成片一点变化没有。所以一个都不放。

type Timing = { seqNo: number; startMs: number; endMs: number }
type Effective = {
  mode: string
  transition: { durationMs: number; bodyCycle?: Cycle[] }
  body: { slotDurationsMs?: number[]; subtitleColor: string; subtitlePosY: number }
  audio: AudioParams
  motion?: { keyframes?: Keyframe[] }
  text?: TextParams & Record<string, number | string>
  pace?: PaceParams
}
type Info = {
  effective: Effective
  override: Record<string, unknown> | null
  bodyTimings: Timing[]
  frameworkName: string | null
  published: boolean
  blockReason: string | null
}
type Bgm = { id: string; fileUrl: string; name: string | null; styleTag: string | null }

export default function StudioPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [info, setInfo] = useState<Info | null>(null)
  const [bgms, setBgms] = useState<Bgm[]>([])
  const [bgmId, setBgmId] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  // 草稿态：各分区独立，保存时只提交本分区改过的字段
  const [slots, setSlots] = useState<number[]>([])
  const [cycle, setCycle] = useState<Cycle[]>([])
  const [kfs, setKfs] = useState<Keyframe[]>([])
  const [audio, setAudio] = useState<AudioParams | null>(null)
  const [capColor, setCapColor] = useState('#ffffff')
  const [capPosY, setCapPosY] = useState(0.78)
  const [text, setText] = useState<TextParams | null>(null)
  const [pace, setPace] = useState<PaceParams | null>(null)
  const [fonts, setFonts] = useState<FontOption[]>([])
  const [scene, setScene] = useState<StageScene>('body')
  const [bg, setBg] = useState<StageBg>('placeholder')
  const [sel, setSel] = useState<StageLayer | null>(null)
  const [sample, setSample] = useState<StageSample>({
    caption: '这是一句示例字幕', captionEn: 'This is a sample caption',
    bookTitle: '活着', bookAuthor: '余华', openTitle: '今天分享的是',
  })

  const load = useCallback(async () => {
    try {
      const [d, fontsRes] = await Promise.all([
        api<Info>(`/api/generate/${id}/params`),
        api<{ builtin: { id: string; label: string; family: string }[]; custom: { id: string; label: string; family: string }[] }>('/api/admin/fonts').catch(() => ({ builtin: [], custom: [] })),
      ])
      setFonts([
        ...fontsRes.builtin.map((f) => ({ ...f, builtin: true })),
        ...fontsRes.custom.map((f) => ({ ...f, builtin: false })),
      ])
      setInfo(d)
      const e = d.effective
      // 分镜时长的当前值优先取 bodyTimings —— 画面实际就是按它切的；
      // slotDurationsMs 只是配额与补静音的目标，两者可能不一致（那正是要调的原因）。
      const fromTimings = d.bodyTimings.slice(1).map((t) => t.endMs - t.startMs)
      setSlots(fromTimings.length ? fromTimings : (e.body.slotDurationsMs ?? []))
      setCycle(e.transition.bodyCycle ?? [])
      setKfs(e.motion?.keyframes ?? [])
      setAudio({ ...e.audio })
      setCapColor(e.body.subtitleColor)
      setCapPosY(e.body.subtitlePosY)
      if (e.text) setText(e.text as TextParams)
      if (e.pace) setPace({ ...e.pace })
    } catch (e) { setErr((e as Error).message) }
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    type TaskDetail = {
      id: string
      variables?: Record<string, unknown> | null
      segments?: { seqNo: number; imageUrl: string | null; bookTitle: string | null; bookAuthor: string | null; captionBeats: unknown }[]
    }
    api<TaskDetail>(`/api/generate/${id}`)
      .then((t) => {
        setBgmId((t.variables?.__bgmId as string) ?? '')
        // 画布示例数据：用本条任务第一段的真实文案（含双语），拉不到就保留组件默认的示例文案。
        const first = t.segments?.[0]
        if (first) {
          const beats = Array.isArray(first.captionBeats) ? (first.captionBeats as { zh?: unknown; en?: unknown }[]) : []
          const beat0 = beats.find((b) => typeof b?.zh === 'string' && (b.zh as string).trim())
          setSample((s) => ({
            ...s,
            caption: (beat0?.zh as string) || s.caption,
            captionEn: (typeof beat0?.en === 'string' && beat0.en) ? (beat0.en as string) : s.captionEn,
            bookTitle: first.bookTitle || s.bookTitle,
            bookAuthor: first.bookAuthor || s.bookAuthor,
          }))
          if (first.imageUrl) setBg({ url: thumbUrl(first.imageUrl) })
        }
      })
      .catch(() => {})
    api<Bgm[]>('/api/bgm').then(setBgms).catch(() => {})
  }, [id])

  if (!info) {
    return err
      ? <div className="space-y-4"><p className="pill pill-bad">{err}</p>
          <Link href="/admin/generate" className="text-sm text-flame">← 返回生成列表</Link></div>
      : <p className="py-16 text-center text-sm text-ink3">加载中…</p>
  }

  const locked = !!info.blockReason
  const segCount = slots.length

  async function save(patch: Record<string, unknown>, what: string) {
    setErr(''); setMsg(''); setBusy(what)
    try {
      await api(`/api/generate/${id}/params`, { method: 'PATCH', body: patch })
      await load()
      setMsg(`${what}已保存。点「应用并重渲」后生效。`)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  async function act(path: string, what: string, then?: () => void) {
    setErr(''); setMsg(''); setBusy(what)
    try {
      await api(`/api/generate/${id}/${path}`, { method: 'POST' })
      then ? then() : await load()
    } catch (e) { setErr((e as Error).message); setBusy('') }
  }

  // 「应用并重渲」：先把任务退回可编辑态，再走已有的「确认合成」。
  // 后者只入队 render-visuals，**不重跑文案/配图/配音**——生图那几百秒不会重来。
  async function applyAndRender() {
    setErr(''); setMsg(''); setBusy('render')
    try {
      await api(`/api/generate/${id}/reset-to-edit`, { method: 'POST' }).catch(() => {})
      await api(`/api/generate/${id}/render`, { method: 'POST' })
      router.push(`/admin/generate/${id}`)
    } catch (e) { setErr((e as Error).message); setBusy('') }
  }

  // 改分镜时长必须重新配音：画面各段起止取自 bodyTimings，而 bodyTimings 是
  // generate-tts 按槽位补静音/变速之后算出来的。只重渲的话画面一帧都不会变。
  async function saveSlotsAndRealign() {
    setErr(''); setMsg(''); setBusy('slots')
    try {
      await api(`/api/generate/${id}/params`, { method: 'PATCH', body: { body: { slotDurationsMs: slots } } })
      await api(`/api/generate/${id}/reset-to-edit`, { method: 'POST' }).catch(() => {})
      await api(`/api/generate/${id}/realign`, { method: 'POST' })
      router.push(`/admin/generate/${id}`)
    } catch (e) { setErr((e as Error).message); setBusy('') }
  }

  return (
    <div className="space-y-5 pb-24">
      <PageHeader title="剪辑工作台" subtitle={info.frameworkName ? `框架：${info.frameworkName}` : undefined}>
        <Link href={`/admin/generate/${id}`} className="btn-ghost">返回详情</Link>
      </PageHeader>

      {err && <p className="pill pill-bad">{err}</p>}
      {msg && <p className="pill pill-ok">{msg}</p>}
      {locked && <p className="pill pill-warn">{info.blockReason}</p>}

      {text && (
        <section className="card space-y-3 p-4 lg:sticky lg:top-4">
          <div className="flex items-center justify-between">
            <p className="eyebrow">画面预览 · 可直接拖</p>
            <button className="btn-ghost text-xs disabled:opacity-50" disabled={locked || !!busy}
              onClick={() => save({ text, body: { subtitleColor: capColor, subtitlePosY: capPosY } }, '画面')}>
              {busy === '画面' ? '保存中…' : '保存画面'}
            </button>
          </div>
          <StageCanvas
            width={BODY_SIZE.width} height={BODY_SIZE.height}
            text={text} captionColor={capColor} captionPosY={capPosY} fonts={fonts}
            scene={scene} onScene={setScene} bg={bg} onBg={setBg}
            sample={sample}
            selected={sel} onSelect={setSel}
            onPosY={(layer, v) => {
              if (locked) return
              switch (layer) {
                case 'caption': setCapPosY(v); break
                case 'bookTitle': setText({ ...text, bookTitlePosY: v }); break
                case 'flashTitle': setText({ ...text, flashTitlePosY: v }); break
                case 'openTitle': setText({ ...text, openTitlePosY: v }); break
                default: break // flashAuthor / watermark：无独立位置参数，不可拖，StageCanvas 不会触发
              }
            }}
            onSize={(layer, v) => {
              if (locked) return
              switch (layer) {
                case 'caption': setText({ ...text, captionSizePx: v }); break
                case 'bookTitle': setText({ ...text, bookTitleScale: v }); break
                case 'flashTitle': setText({ ...text, flashTitleScale: v }); break
                case 'openTitle': setText({ ...text, openTitleScale: v }); break
                default: break // flashAuthor / watermark：无独立字号参数，不可拖，StageCanvas 不会触发
              }
            }}
          />
        </section>
      )}

      {info.override && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <span className="eyebrow">本条已有自定义参数</span>
          <span className="text-xs text-ink3">框架默认值被这条任务的设置覆盖中</span>
          <button className="btn-ghost text-xs" disabled={locked || !!busy}
            onClick={() => act('params/promote', '保存为模板默认值')}>
            保存为模板默认值（以后同框架都按这个来）
          </button>
          <button className="btn-ghost text-xs" disabled={locked || !!busy}
            onClick={async () => {
              setBusy('reset')
              try { await api(`/api/generate/${id}/params`, { method: 'DELETE' }); await load(); setMsg('已恢复框架默认') }
              catch (e) { setErr((e as Error).message) } finally { setBusy('') }
            }}>
            恢复框架默认
          </button>
        </div>
      )}

      {/* ── 节奏 ── */}
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">节奏 · 每段停留多久</p>
          <button className="btn-primary text-xs disabled:opacity-50" disabled={locked || !!busy || segCount === 0}
            onClick={saveSlotsAndRealign}>
            {busy === 'slots' ? '保存并重新配音中…' : '保存并重新配音对齐'}
          </button>
        </div>
        <p className="text-xs text-ink3">
          改时长要**重新配音**才生效：画面各段的起止来自配音对齐的结果，不是直接来自这里的数值。
          只点「应用并重渲」的话画面不会变。
        </p>
        <SlotRows slots={slots} onChange={setSlots} disabled={locked} />
      </section>

      {/* ── 转场 ── */}
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">转场 · 正片各边界</p>
          <button className="btn-ghost text-xs disabled:opacity-50" disabled={locked || !!busy}
            onClick={() => save({ transition: { bodyCycle: cycle } }, '转场')}>
            {busy === '转场' ? '保存中…' : '保存转场'}
          </button>
        </div>
        <TransitionRows cycle={cycle} onChange={setCycle} disabled={locked} />
      </section>

      {/* ── 运镜 ── */}
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">运镜 · 逐段推近幅度</p>
          <button className="btn-ghost text-xs disabled:opacity-50" disabled={locked || !!busy}
            onClick={() => save({ motion: { keyframes: kfs } }, '运镜')}>
            {busy === '运镜' ? '保存中…' : '保存运镜'}
          </button>
        </div>
        <MotionRows kfs={kfs} onChange={setKfs} disabled={locked} />
      </section>

      {/* ── 字幕样式 ── */}
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">字幕样式</p>
          <button className="btn-ghost text-xs disabled:opacity-50" disabled={locked || !!busy}
            onClick={() => save({ body: { subtitleColor: capColor, subtitlePosY: capPosY }, ...(text ? { text } : {}) }, '字幕样式')}>
            {busy === '字幕样式' ? '保存中…' : '保存字幕样式'}
          </button>
        </div>
        <CaptionStyleRows color={capColor} posY={capPosY} onColor={setCapColor} onPosY={setCapPosY}
          text={text} onText={setText} disabled={locked} />
      </section>

      {/* ── 文字层 ── */}
      {text && (
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="eyebrow">文字层 · 字号 / 描边 / 加粗 / 颜色</p>
            <button className="btn-ghost text-xs disabled:opacity-50" disabled={locked || !!busy}
              onClick={() => save({ text }, '文字层')}>
              {busy === '文字层' ? '保存中…' : '保存文字层'}
            </button>
          </div>
          <TextRows text={text} onChange={setText} fonts={fonts} disabled={locked} />
        </section>
      )}

      {/* ── 节奏留白 ──
          语速与留白影响的是**配音**，保存后要走「保存并重新配音对齐」或整条重渲才可闻。 */}
      {pace && (
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="eyebrow">节奏留白与语速</p>
            <button className="btn-ghost text-xs disabled:opacity-50" disabled={locked || !!busy}
              onClick={() => save({ pace }, '节奏留白')}>
              {busy === '节奏留白' ? '保存中…' : '保存节奏留白'}
            </button>
          </div>
          <p className="text-xs text-ink3">这些改的是**配音**（留白插在音轨里）。保存后需「保存并重新配音对齐」才生效，只重渲画面听不出变化。</p>
          <PaceRows pace={pace} onChange={setPace} disabled={locked} />
        </section>
      )}

      {/* ── 配乐 ── */}
      {audio && (
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="eyebrow">配乐</p>
            <button className="btn-ghost text-xs disabled:opacity-50" disabled={locked || !!busy}
              onClick={() => save({ audio }, '配乐')}>
              {busy === '配乐' ? '保存中…' : '保存配乐参数'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-40 shrink-0 text-xs text-ink3">曲子</span>
            <select className="field max-w-xs text-sm" value={bgmId} disabled={locked || busy === 'bgm'}
              onChange={async (e) => {
                const v = e.target.value
                setBgmId(v); setBusy('bgm')
                try { await api(`/api/generate/${id}/bgm`, { method: 'POST', body: { bgmId: v || null } }); setMsg('已换曲（重渲后生效）') }
                catch (x) { setErr((x as Error).message) } finally { setBusy('') }
              }}>
              <option value="">不使用 BGM</option>
              {bgms.map((b) => <option key={b.id} value={b.id}>{b.name || b.styleTag || b.id.slice(0, 8)}</option>)}
            </select>
            {bgmId && bgms.find((b) => b.id === bgmId) && (
              <audio controls src={bgms.find((b) => b.id === bgmId)!.fileUrl} className="h-9" />
            )}
            <Link href="/admin/bgm" className="text-xs text-flame">管理曲库 →</Link>
          </div>
          <AudioRows audio={audio} onChange={setAudio} disabled={locked} />
        </section>
      )}

      {/* 固定操作条 */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
          <span className="mr-auto text-xs text-ink3">
            重渲只重跑画面合成与混音，不重新生成文案/配图/配音，约 1～2 分钟。
          </span>
          <button className="btn-primary disabled:opacity-50" disabled={locked || !!busy} onClick={applyAndRender}>
            {busy === 'render' ? '已提交，跳转中…' : '应用并重渲'}
          </button>
        </div>
      </div>
    </div>
  )
}
