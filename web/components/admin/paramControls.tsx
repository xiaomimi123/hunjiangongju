'use client'
// 剪辑参数的共用控件。
//
// 两个页面用同一套：
//   - /admin/generate/[id]/studio   调**这一条片子**（存进任务的参数覆盖）
//   - /admin/frameworks/[id]/studio 调**框架默认值**（存进 overlayTemplate.__templateParams）
// 控件形态必须一致，否则同一个参数在两处长得不一样，运营会以为是两回事。
//
// 只做受控组件、不引表单库——与后台其余页面的写法保持一致（那边也是裸 useState）。

export type Cycle = { renderType: string; durationMs: number }
export type Keyframe = { scaleFrom: number; scaleTo: number }
export type AudioParams = {
  bgmVolume: number
  bgmStartMs: number
  bgmFadeInMs: number
  bgmFadeOutMs: number
}

export const fmtSec = (n: number) => `${(n / 1000).toFixed(2)}s`

/** 一行「标签 + 数字输入 + 单位/提示」 */
export function NumRow(props: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number; max?: number; step?: number
  unit?: string; hint?: string; disabled?: boolean
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

export function SlotRows(props: {
  slots: number[]; onChange: (v: number[]) => void; disabled?: boolean
}) {
  if (props.slots.length === 0) {
    return <p className="text-xs text-ink3">还没有分镜时长（框架未从剪映草稿解析出正片段，或任务尚未完成配音对齐）。</p>
  }
  return (
    <>
      {props.slots.map((v, i) => (
        <NumRow key={i} label={`第 ${i + 1} 段`} value={v} disabled={props.disabled}
          min={1000} max={60000} step={100} unit="ms" hint={fmtSec(v)}
          onChange={(n) => props.onChange(props.slots.map((x, j) => (j === i ? n : x)))} />
      ))}
    </>
  )
}

/**
 * 转场：只给「叠化 / 硬切」两项。
 *
 * 渲染层目前只实现了 crossfade（FfTransition = 'crossfade' | null），
 * 契约里声明的 wipe / shard / glide-push / blur-dissolve 在成片里一律呈现为叠化。
 * 做成四选一的下拉框会误导运营，所以不给。硬切用**时长 0** 表达。
 */
export function TransitionRows(props: {
  cycle: Cycle[]; onChange: (v: Cycle[]) => void; disabled?: boolean
}) {
  const set = (i: number, patch: Partial<Cycle>) =>
    props.onChange(props.cycle.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <>
      <p className="text-xs text-ink3">
        渲染层目前只实现了叠化，所以只有「叠化 / 硬切」两种。原工程里的擦除、碎片等类型在成片里一律呈现为叠化。
      </p>
      {props.cycle.map((c, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          <span className="w-40 shrink-0 text-xs text-ink3">边界 {i + 1}</span>
          <select className="field w-28 text-sm" disabled={props.disabled}
            value={c.durationMs > 0 ? 'fade' : 'cut'}
            onChange={(e) => set(i, { durationMs: e.target.value === 'cut' ? 0 : (c.durationMs || 400) })}>
            <option value="fade">叠化</option>
            <option value="cut">硬切</option>
          </select>
          {c.durationMs > 0 && (
            <>
              <input type="number" className="field w-28 text-sm" disabled={props.disabled}
                min={1} max={2000} step={50} value={c.durationMs}
                onChange={(e) => set(i, { durationMs: Number(e.target.value) })} />
              <span className="text-xs text-ink3">ms</span>
            </>
          )}
          <button className="btn-ghost text-xs" disabled={props.disabled}
            onClick={() => props.onChange(props.cycle.filter((_, j) => j !== i))}>删除</button>
        </div>
      ))}
      <button className="btn-ghost text-xs" disabled={props.disabled}
        onClick={() => props.onChange([...props.cycle, { renderType: 'crossfade', durationMs: 400 }])}>
        + 增加一条边界（按序循环套用到正片各边界）
      </button>
    </>
  )
}

/** 运镜：逐段推近。motion.moves（6 种预设招式）是死字段，全 worker 零消费点，不放。 */
export function MotionRows(props: {
  kfs: Keyframe[]; onChange: (v: Keyframe[]) => void; disabled?: boolean
}) {
  const set = (i: number, patch: Partial<Keyframe>) =>
    props.onChange(props.kfs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <>
      <p className="text-xs text-ink3">从 1.0 推到 1.10 即缓慢推近 10%。一条都不设时画面静止。</p>
      {props.kfs.map((k, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          <span className="w-40 shrink-0 text-xs text-ink3">第 {i + 1} 段</span>
          <input type="number" className="field w-24 text-sm" disabled={props.disabled}
            min={1} max={2} step={0.01} value={k.scaleFrom}
            onChange={(e) => set(i, { scaleFrom: Number(e.target.value) })} />
          <span className="text-xs text-ink3">→</span>
          <input type="number" className="field w-24 text-sm" disabled={props.disabled}
            min={1} max={2} step={0.01} value={k.scaleTo}
            onChange={(e) => set(i, { scaleTo: Number(e.target.value) })} />
          <button className="btn-ghost text-xs" disabled={props.disabled}
            onClick={() => props.onChange(props.kfs.filter((_, j) => j !== i))}>删除</button>
        </div>
      ))}
      <button className="btn-ghost text-xs" disabled={props.disabled}
        onClick={() => props.onChange([...props.kfs, { scaleFrom: 1, scaleTo: 1.1 }])}>
        + 增加一段（按序循环套用）
      </button>
    </>
  )
}

export function CaptionStyleRows(props: {
  color: string; posY: number
  onColor: (v: string) => void; onPosY: (v: number) => void
  disabled?: boolean
}) {
  return (
    <>
      <label className="flex items-center gap-3 py-1">
        <span className="w-40 shrink-0 text-xs text-ink3">正文字幕颜色</span>
        <input type="color" className="h-8 w-14 rounded border border-line" disabled={props.disabled}
          value={props.color} onChange={(e) => props.onColor(e.target.value)} />
        <span className="num text-xs text-ink3">{props.color}</span>
      </label>
      <NumRow label="正文字幕竖直位置" value={props.posY} disabled={props.disabled}
        min={0} max={1} step={0.01} hint="0 = 顶端，1 = 底端" onChange={props.onPosY} />
      <p className="text-xs text-ink3">
        字号与字体暂不可调：正文字号是渲染层的锚点常量，字体固定用自带的 Noto Sans SC。
      </p>
    </>
  )
}

export function AudioRows(props: {
  audio: AudioParams; onChange: (v: AudioParams) => void; disabled?: boolean
}) {
  const set = (patch: Partial<AudioParams>) => props.onChange({ ...props.audio, ...patch })
  return (
    <>
      <NumRow label="音量" value={props.audio.bgmVolume} disabled={props.disabled}
        min={0} max={1} step={0.01} hint="相对人声" onChange={(v) => set({ bgmVolume: v })} />
      <NumRow label="从第几秒开始" value={props.audio.bgmStartMs} disabled={props.disabled}
        min={0} step={500} unit="ms" hint={`${fmtSec(props.audio.bgmStartMs)}（用来卡副歌）`}
        onChange={(v) => set({ bgmStartMs: v })} />
      <NumRow label="淡入" value={props.audio.bgmFadeInMs} disabled={props.disabled}
        min={0} max={30000} step={100} unit="ms" onChange={(v) => set({ bgmFadeInMs: v })} />
      <NumRow label="淡出" value={props.audio.bgmFadeOutMs} disabled={props.disabled}
        min={0} max={30000} step={100} unit="ms" onChange={(v) => set({ bgmFadeOutMs: v })} />
    </>
  )
}
