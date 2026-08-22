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
        字号在「文字层」分区调（正文字号锚点）；字体固定用自带的 Noto Sans SC。
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

export type TextParams = {
  captionSizePx: number
  bookTitleBoost: number
  outlinePx: number
  boldBordPx: number
  bookTitleColor: string
  flashTitleColor: string
  flashAuthorColor: string
  openTitleColor: string
  bookTitleScale: number
  flashTitleScale: number
  openTitleScale: number
}
export type PaceParams = { bookTitleLeadMs: number; bookTitleTailMs: number; speechCharsPerSec: number; maxTempo: number }
export type ScriptParams = { openingTitleOnly: boolean; titleInOpening: boolean; titleSegment: number; chineseTitlesOnly: boolean; extraRules: string; captionMaxChars: number }

function ColorRow(props: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-40 shrink-0 text-xs text-ink3">{props.label}</span>
      <input type="color" className="h-8 w-14 rounded border border-line" disabled={props.disabled}
        value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      <span className="num text-xs text-ink3">{props.value}</span>
    </label>
  )
}

/** 文字层全套：字号锚点、各层放大倍数、描边、加粗、颜色。线上「字太小/要加粗/看不清」的反馈全在这里解决。 */
export function TextRows(props: {
  text: TextParams; onChange: (v: TextParams) => void; disabled?: boolean
}) {
  const set = (patch: Partial<TextParams>) => props.onChange({ ...props.text, ...patch })
  const t = props.text
  return (
    <>
      <NumRow label="正文字号（锚点）" value={t.captionSizePx} disabled={props.disabled}
        min={20} max={120} step={2} unit="px" hint="其余各层字号都按它的倍数派生"
        onChange={(v) => set({ captionSizePx: v })} />
      <NumRow label="书名标题倍数" value={t.bookTitleScale} disabled={props.disabled}
        min={0.2} max={5} step={0.05} hint="相对正文" onChange={(v) => set({ bookTitleScale: v })} />
      <NumRow label="书名标题再放大" value={t.bookTitleBoost} disabled={props.disabled}
        min={0.5} max={3} step={0.05} hint="嫌书名还不够大就调它" onChange={(v) => set({ bookTitleBoost: v })} />
      <NumRow label="快闪书名倍数" value={t.flashTitleScale} disabled={props.disabled}
        min={0.2} max={5} step={0.05} onChange={(v) => set({ flashTitleScale: v })} />
      <NumRow label="开场标题倍数" value={t.openTitleScale} disabled={props.disabled}
        min={0.2} max={5} step={0.05} onChange={(v) => set({ openTitleScale: v })} />
      <NumRow label="描边宽度" value={t.outlinePx} disabled={props.disabled}
        min={0} max={10} step={0.5} unit="px" hint="浅底图上字看不清就调大"
        onChange={(v) => set({ outlinePx: v })} />
      <NumRow label="书名加粗" value={t.boldBordPx} disabled={props.disabled}
        min={0} max={5} step={0.2} unit="px" hint="0 = 不加粗（字体无粗体字面，加粗靠同色描边撑粗）"
        onChange={(v) => set({ boldBordPx: v })} />
      <ColorRow label="书名标题颜色" value={t.bookTitleColor} disabled={props.disabled}
        onChange={(v) => set({ bookTitleColor: v })} />
      <ColorRow label="快闪书名颜色" value={t.flashTitleColor} disabled={props.disabled}
        onChange={(v) => set({ flashTitleColor: v })} />
      <ColorRow label="快闪作者颜色" value={t.flashAuthorColor} disabled={props.disabled}
        onChange={(v) => set({ flashAuthorColor: v })} />
      <ColorRow label="开场标题颜色" value={t.openTitleColor} disabled={props.disabled}
        onChange={(v) => set({ openTitleColor: v })} />
    </>
  )
}

export function PaceRows(props: {
  pace: PaceParams; onChange: (v: PaceParams) => void; disabled?: boolean
}) {
  const set = (patch: Partial<PaceParams>) => props.onChange({ ...props.pace, ...patch })
  return (
    <>
      <NumRow label="书名前留白" value={props.pace.bookTitleLeadMs} disabled={props.disabled}
        min={0} max={3000} step={100} unit="ms" hint="快闪结束后停顿多久再报书名"
        onChange={(v) => set({ bookTitleLeadMs: v })} />
      <NumRow label="书名后停顿" value={props.pace.bookTitleTailMs} disabled={props.disabled}
        min={0} max={2000} step={100} unit="ms" hint="书名念完停多久再进正文（0 = 连着念）"
        onChange={(v) => set({ bookTitleTailMs: v })} />
      <NumRow label="配音语速" value={props.pace.speechCharsPerSec} disabled={props.disabled}
        min={2} max={12} step={0.1} unit="字/秒" hint="换音色后要重新标定（看 worker 日志）"
        onChange={(v) => set({ speechCharsPerSec: v })} />
      <NumRow label="变速上限" value={props.pace.maxTempo} disabled={props.disabled}
        min={1} max={2} step={0.05} unit="×" hint="1 = 禁止变速；话太长时超出部分让画面变长"
        onChange={(v) => set({ maxTempo: v })} />
    </>
  )
}

/** 文案口径：结构化开关 + 自由规则文本。改的是**给 AI 的提示词**，只影响以后生成的文案。 */
export function ScriptRows(props: {
  script: ScriptParams; onChange: (v: ScriptParams) => void; disabled?: boolean
}) {
  const set = (patch: Partial<ScriptParams>) => props.onChange({ ...props.script, ...patch })
  const s = props.script
  return (
    <>
      <label className="flex items-center gap-3 py-1">
        <span className="w-40 shrink-0 text-xs text-ink3">开场白只念标题</span>
        <input type="checkbox" checked={s.openingTitleOnly} disabled={props.disabled}
          onChange={(e) => set({ openingTitleOnly: e.target.checked })} />
        <span className="text-xs text-ink3">开场只念「今天分享的是」这几个字，不加其它话（原工程即如此）</span>
      </label>
      <label className="flex items-center gap-3 py-1">
        <span className="w-40 shrink-0 text-xs text-ink3">书名什么时候报出</span>
        <select className="field w-56 text-sm" disabled={props.disabled}
          value={s.titleInOpening ? 'opening' : 'later'}
          onChange={(e) => set({ titleInOpening: e.target.value === 'opening' })}>
          <option value="later">开场白不报，留到正片（对齐快闪揭晓）</option>
          <option value="opening">开场白里直接报出</option>
        </select>
      </label>
      {!s.titleInOpening && (
        <NumRow label="书名在第几段报出" value={s.titleSegment} disabled={props.disabled}
          min={1} max={9} step={1} hint="1 起数；超过段数按最后一段" onChange={(v) => set({ titleSegment: v })} />
      )}
      <label className="flex items-center gap-3 py-1">
        <span className="w-40 shrink-0 text-xs text-ink3">只推荐中文书名</span>
        <input type="checkbox" checked={s.chineseTitlesOnly} disabled={props.disabled}
          onChange={(e) => set({ chineseTitlesOnly: e.target.checked })} />
        <span className="text-xs text-ink3">关掉则允许外文书出现在快闪卡</span>
      </label>
      <NumRow label="每拍字幕最多字数" value={s.captionMaxChars} disabled={props.disabled}
        min={6} max={24} step={1} hint="超过就再切一拍；嫌一行字太满就调小"
        onChange={(v) => set({ captionMaxChars: v })} />
      <label className="block py-1">
        <span className="text-xs text-ink3">附加规则（逐行写给 AI 的额外要求，原样进提示词）</span>
        <textarea className="field mt-1 w-full text-xs" rows={4} disabled={props.disabled}
          placeholder={'每行一条，例如：\n结尾必须用反问收束\n不要出现任何数字'}
          value={s.extraRules} onChange={(e) => set({ extraRules: e.target.value })} />
      </label>
      <p className="text-xs text-ink3">改文案口径只影响**以后生成**的文案；已生成的片子要用新口径需整条重新生成。</p>
    </>
  )
}
