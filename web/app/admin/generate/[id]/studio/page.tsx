'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'

// 剪辑工作台：调这一条片子的节奏、字幕样式、配乐，然后重渲。
//
// 只暴露**渲染层真的会读**的参数。契约里另有一批「草稿解析出来了但渲染器不读」的字段
//（kenBurns / photoScale / subtitleEntrance / subtitleFontFamily / flash.scale /
// grade.filterName / motion.moves / enterBodyHardCut 等，均已逐个 grep 核实），
// 做成控件就是让人调空气——界面改了、保存成功了、成片一点变化没有。所以一个都不放。

type Timing = { seqNo: number; startMs: number; endMs: number }
type Cycle = { renderType: string; durationMs: number }
type Keyframe = { scaleFrom: number; scaleTo: number }
type Effective = {
  mode: string
  transition: { durationMs: number; bodyCycle?: Cycle[] }
  body: { slotDurationsMs?: number[]; subtitleColor: string; subtitlePosY: number }
  audio: { bgmVolume: number; bgmStartMs: number; bgmFadeInMs: number; bgmFadeOutMs: number }
  motion?: { keyframes?: Keyframe[] }
  text?: Record<string, number>
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

const ms = (n: number) => `${(n / 1000).toFixed(2)}s`

/** 一行「标签 + 数字输入 + 单位」。后台没有共用表单组件，沿用 field/eyebrow 这套 class。 */
function NumRow(props: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; unit?: string; hint?: string; disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-40 shrink-0 text-xs text-ink3">{props.label}</span>
      <input
        type="number" className="field w-32 text-sm" value={props.value} disabled={props.disabled}
        min={props.min} max={props.max} step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.unit && <span className="text-xs text-ink3">{props.unit}</span>}
      {props.hint && <span className="text-xs text-ink3">{props.hint}</span>}
    </label>
  )
}

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
  const [audio, setAudio] = useState<Effective['audio'] | null>(null)
  const [capColor, setCapColor] = useState('#ffffff')
  const [capPosY, setCapPosY] = useState(0.78)

  const load = useCallback(async () => {
    try {
      const d = await api<Info>(`/api/generate/${id}/params`)
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
    } catch (e) { setErr((e as Error).message) }
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api<{ id: string; variables?: Record<string, unknown> | null }>(`/api/generate/${id}`)
      .then((t) => setBgmId((t.variables?.__bgmId as string) ?? '')).catch(() => {})
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
        {slots.map((v, i) => (
          <NumRow key={i} label={`第 ${i + 1} 段`} value={v} disabled={locked} min={1000} max={60000} step={100}
            unit="ms" hint={ms(v)} onChange={(n) => setSlots((s) => s.map((x, j) => (j === i ? n : x)))} />
        ))}
        {segCount === 0 && <p className="text-xs text-ink3">这条任务还没有分段时间轴（需先完成配音对齐）。</p>}
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
        <p className="text-xs text-ink3">
          渲染层目前只实现了**叠化**，所以这里只有「叠化 / 硬切」两种。
          原工程里的擦除、碎片等类型在成片里一律呈现为叠化，做成下拉框会误导。
        </p>
        {cycle.map((c, i) => (
          <div key={i} className="flex items-center gap-3 py-1">
            <span className="w-40 shrink-0 text-xs text-ink3">边界 {i + 1}</span>
            <select className="field w-28 text-sm" disabled={locked}
              value={c.durationMs > 0 ? 'fade' : 'cut'}
              onChange={(e) => setCycle((cs) => cs.map((x, j) => j === i
                ? { ...x, durationMs: e.target.value === 'cut' ? 0 : (x.durationMs || 400) } : x))}>
              <option value="fade">叠化</option>
              <option value="cut">硬切</option>
            </select>
            {c.durationMs > 0 && (
              <input type="number" className="field w-28 text-sm" disabled={locked} min={1} max={2000} step={50}
                value={c.durationMs}
                onChange={(e) => setCycle((cs) => cs.map((x, j) => j === i ? { ...x, durationMs: Number(e.target.value) } : x))} />
            )}
            {c.durationMs > 0 && <span className="text-xs text-ink3">ms</span>}
          </div>
        ))}
        <button className="btn-ghost text-xs" disabled={locked}
          onClick={() => setCycle((cs) => [...cs, { renderType: 'crossfade', durationMs: 400 }])}>
          + 增加一条边界（按序循环套用到正片各边界）
        </button>
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
        <p className="text-xs text-ink3">从 1.0 推到 1.10 即缓慢推近 10%。留空（没有任何一条）时画面静止。</p>
        {kfs.map((k, i) => (
          <div key={i} className="flex items-center gap-3 py-1">
            <span className="w-40 shrink-0 text-xs text-ink3">第 {i + 1} 段</span>
            <input type="number" className="field w-24 text-sm" disabled={locked} min={1} max={2} step={0.01}
              value={k.scaleFrom}
              onChange={(e) => setKfs((a) => a.map((x, j) => j === i ? { ...x, scaleFrom: Number(e.target.value) } : x))} />
            <span className="text-xs text-ink3">→</span>
            <input type="number" className="field w-24 text-sm" disabled={locked} min={1} max={2} step={0.01}
              value={k.scaleTo}
              onChange={(e) => setKfs((a) => a.map((x, j) => j === i ? { ...x, scaleTo: Number(e.target.value) } : x))} />
          </div>
        ))}
        <button className="btn-ghost text-xs" disabled={locked}
          onClick={() => setKfs((a) => [...a, { scaleFrom: 1, scaleTo: 1.1 }])}>
          + 增加一段（按序循环套用）
        </button>
      </section>

      {/* ── 字幕样式 ── */}
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">字幕样式</p>
          <button className="btn-ghost text-xs disabled:opacity-50" disabled={locked || !!busy}
            onClick={() => save({ body: { subtitleColor: capColor, subtitlePosY: capPosY } }, '字幕样式')}>
            {busy === '字幕样式' ? '保存中…' : '保存字幕样式'}
          </button>
        </div>
        <label className="flex items-center gap-3 py-1">
          <span className="w-40 shrink-0 text-xs text-ink3">正文字幕颜色</span>
          <input type="color" className="h-8 w-14 rounded border border-line" disabled={locked}
            value={capColor} onChange={(e) => setCapColor(e.target.value)} />
          <span className="num text-xs text-ink3">{capColor}</span>
        </label>
        <NumRow label="正文字幕竖直位置" value={capPosY} disabled={locked} min={0} max={1} step={0.01}
          hint="0 = 顶端，1 = 底端" onChange={setCapPosY} />
        <p className="text-xs text-ink3">
          字号与字体暂不可调：正文字号是渲染层的锚点常量，字体固定用自带的 Noto Sans SC。
        </p>
      </section>

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
          <NumRow label="音量" value={audio.bgmVolume} disabled={locked} min={0} max={1} step={0.01}
            hint="相对人声" onChange={(v) => setAudio({ ...audio, bgmVolume: v })} />
          <NumRow label="从第几秒开始" value={audio.bgmStartMs} disabled={locked} min={0} step={500}
            unit="ms" hint={`${ms(audio.bgmStartMs)}（用来卡副歌）`} onChange={(v) => setAudio({ ...audio, bgmStartMs: v })} />
          <NumRow label="淡入" value={audio.bgmFadeInMs} disabled={locked} min={0} max={30000} step={100}
            unit="ms" onChange={(v) => setAudio({ ...audio, bgmFadeInMs: v })} />
          <NumRow label="淡出" value={audio.bgmFadeOutMs} disabled={locked} min={0} max={30000} step={100}
            unit="ms" onChange={(v) => setAudio({ ...audio, bgmFadeOutMs: v })} />
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
