// 剪辑工作台能改哪些参数——**白名单**，不是黑名单。
//
// 为什么必须白名单：`TemplateParams` 里有一批字段是「草稿解析出来了，但渲染器根本不读」
// 的死字段（已逐个 grep 核实）：
//   body.kenBurns / body.photoScale / body.subtitleEntrance / body.subtitleFontFamily
//  （字体恒为 DEFAULT_FONT_NAME）/ flash.scale / flash.hardCut / flash.titleFontFamily /
//   grade.filterName / transition.enterBodyHardCut / motion.moves
// 放开它们等于让运营调空气：界面上改了、保存成功了、成片一点变化没有，
// 排查成本极高。所以接口层直接不收。
//
// 另一批是**改了也不会立刻生效**的：body.slotDurationsMs 只喂文案配额与配音补静音，
// 画面各段起止取自 GenerationTask.bodyTimings，改完必须重新配音对齐（realign）
// 才会反映到画面上。这个由调用方负责提示，不在这里拦。

const clampNum = (v: unknown, lo: number, hi: number): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.min(hi, Math.max(lo, v))
}

const posIntArray = (v: unknown, max: number): number[] | undefined => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 64) return undefined
  const out: number[] = []
  for (const x of v) {
    const n = clampNum(x, 1, max)
    if (n === undefined) return undefined
    out.push(Math.round(n))
  }
  return out
}

function obj(x: unknown): Record<string, unknown> | undefined {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined
}

/** 单段分镜时长上限（ms）。60 秒一张图已经远超任何合理节奏，超出必是误输入。 */
const MAX_SLOT_MS = 60_000

/**
 * 把请求体过成一份**只含白名单字段**的局部 TemplateParams。
 *
 * - 只输出请求里真正给了的字段（局部覆盖，不补默认值）——补了默认值就等于把
 *   框架里没配过的字段也钉死成默认值，框架以后再改也带不动这条任务。
 * - 数值一律夹到合理区间，不抛错：这是运营界面来的输入，夹住比报错更顺手，
 *   而越界值（比如负的转场时长）会让 ffmpeg 产出诡异结果。
 * - 认不出的键**直接丢弃**。
 *
 * @returns 过滤后的覆盖；一个白名单字段都没命中时返回 null
 */
export function sanitizeParamsOverride(raw: unknown): Record<string, unknown> | null {
  const r = obj(raw)
  if (!r) return null
  const out: Record<string, unknown> = {}

  // ── 节奏：逐段时长 ──
  const body = obj(r.body)
  if (body) {
    const b: Record<string, unknown> = {}
    const slots = posIntArray(body.slotDurationsMs, MAX_SLOT_MS)
    if (slots) b.slotDurationsMs = slots
    // 正文字幕的颜色与竖直位置（渲染层真读这两个）
    if (typeof body.subtitleColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.subtitleColor)) {
      b.subtitleColor = body.subtitleColor
    }
    const posY = clampNum(body.subtitlePosY, 0, 1)
    if (posY !== undefined) b.subtitlePosY = posY
    if (Object.keys(b).length) out.body = b
  }

  // ── 转场：只放行「叠化 / 硬切」──
  //
  // 渲染层只实现了 crossfade（FfTransition = 'crossfade' | null），契约里声明的
  // wipe / shard / glide-push / blur-dissolve 全部退化成叠化。做成四选一的下拉框
  // 就是骗人，所以这里把 renderType 固定写成 'crossfade'，用**时长**表达硬切：
  // durationMs = 0 → 该边界硬切（见 renderFull.ts / renderBody.ts）。
  const tr = obj(r.transition)
  if (tr) {
    const t: Record<string, unknown> = {}
    const d = clampNum(tr.durationMs, 0, 2000)
    if (d !== undefined) t.durationMs = Math.round(d)
    if (Array.isArray(tr.bodyCycle) && tr.bodyCycle.length > 0 && tr.bodyCycle.length <= 64) {
      const cyc: { renderType: 'crossfade'; durationMs: number }[] = []
      let ok = true
      for (const e of tr.bodyCycle) {
        const eo = obj(e)
        const ed = clampNum(eo?.durationMs, 0, 2000)
        if (ed === undefined) { ok = false; break }
        cyc.push({ renderType: 'crossfade', durationMs: Math.round(ed) })
      }
      if (ok) t.bodyCycle = cyc
    }
    if (Object.keys(t).length) { t.type = 'dissolve'; out.transition = t }
  }

  // ── 运镜：逐段缩放。motion.moves 是死字段，不收 ──
  const mo = obj(r.motion)
  if (mo && Array.isArray(mo.keyframes) && mo.keyframes.length > 0 && mo.keyframes.length <= 64) {
    const kfs: { scaleFrom: number; scaleTo: number }[] = []
    let ok = true
    for (const e of mo.keyframes) {
      const eo = obj(e)
      const from = clampNum(eo?.scaleFrom, 1, 2)
      const to = clampNum(eo?.scaleTo, 1, 2)
      if (from === undefined || to === undefined) { ok = false; break }
      kfs.push({ scaleFrom: from, scaleTo: to })
    }
    // moves 必须给一个空数组：TemplateParams.motion 的 moves 是必填字段，
    // 只给 keyframes 会让合并后的对象缺 moves，parseTemplateParams 虽能兜底，
    // 但存进库里的是一份结构不完整的 JSON，后续人肉排查时容易误判。
    if (ok) out.motion = { moves: [], keyframes: kfs }
  }

  // ── 配乐 ──
  const audio = obj(r.audio)
  if (audio) {
    const a: Record<string, unknown> = {}
    const vol = clampNum(audio.bgmVolume, 0, 1)
    if (vol !== undefined) a.bgmVolume = vol
    const st = clampNum(audio.bgmStartMs, 0, 30 * 60_000)
    if (st !== undefined) a.bgmStartMs = Math.round(st)
    const fi = clampNum(audio.bgmFadeInMs, 0, 30_000)
    if (fi !== undefined) a.bgmFadeInMs = Math.round(fi)
    const fo = clampNum(audio.bgmFadeOutMs, 0, 30_000)
    if (fo !== undefined) a.bgmFadeOutMs = Math.round(fo)
    if (Object.keys(a).length) out.audio = a
  }

  // ── 文字层：位置、相对字号、锚点字号、描边、加粗、颜色 ──
  const HEX = /^#[0-9a-fA-F]{6}$/
  const text = obj(r.text)
  if (text) {
    const t: Record<string, unknown> = {}
    for (const k of ['openTitlePosY', 'flashTitlePosY', 'bookTitlePosY'] as const) {
      const v = clampNum(text[k], 0, 1)
      if (v !== undefined) t[k] = v
    }
    for (const k of ['openTitleScale', 'flashTitleScale', 'bookTitleScale'] as const) {
      const v = clampNum(text[k], 0.2, 5)
      if (v !== undefined) t[k] = v
    }
    // 锚点字号：全片各层字号都由它派生。20~120px 之外在 720 宽画布上必是误输入
    const cap = clampNum(text.captionSizePx, 20, 120)
    if (cap !== undefined) t.captionSizePx = Math.round(cap)
    const boost = clampNum(text.bookTitleBoost, 0.5, 3)
    if (boost !== undefined) t.bookTitleBoost = boost
    const outl = clampNum(text.outlinePx, 0, 10)
    if (outl !== undefined) t.outlinePx = outl
    const bb = clampNum(text.boldBordPx, 0, 5)
    if (bb !== undefined) t.boldBordPx = bb
    const fin = clampNum(text.captionFadeInMs, 0, 1000)
    if (fin !== undefined) t.captionFadeInMs = Math.round(fin)
    const fout = clampNum(text.captionFadeOutMs, 0, 1000)
    if (fout !== undefined) t.captionFadeOutMs = Math.round(fout)
    for (const k of ['bookTitleColor', 'flashTitleColor', 'flashAuthorColor', 'openTitleColor'] as const) {
      if (typeof text[k] === 'string' && HEX.test(text[k] as string)) t[k] = text[k]
    }
    // 双语字幕。渲染层真读（ass.ts 的 bilingual/enScale/enColor/enGapPx），不是死字段。
    if (typeof text.bilingual === 'boolean') t.bilingual = text.bilingual
    const es = clampNum(text.enScale, 0.3, 1)
    if (es !== undefined) t.enScale = es
    const eg = clampNum(text.enGapPx, 0, 40)
    if (eg !== undefined) t.enGapPx = Math.round(eg)
    if (typeof text.enColor === 'string' && HEX.test(text.enColor)) t.enColor = text.enColor
    if (Object.keys(t).length) out.text = t
  }

  // ── 节奏留白与语速 ──
  const pace = obj(r.pace)
  if (pace) {
    const pc: Record<string, unknown> = {}
    const lead = clampNum(pace.bookTitleLeadMs, 0, 3000)
    if (lead !== undefined) pc.bookTitleLeadMs = Math.round(lead)
    const tail = clampNum(pace.bookTitleTailMs, 0, 2000)
    if (tail !== undefined) pc.bookTitleTailMs = Math.round(tail)
    const rate = clampNum(pace.speechCharsPerSec, 2, 12)
    if (rate !== undefined) pc.speechCharsPerSec = rate
    const tempo = clampNum(pace.maxTempo, 1, 2)
    if (tempo !== undefined) pc.maxTempo = tempo
    if (Object.keys(pc).length) out.pace = pc
  }

  // ── 文案口径 ──
  const script = obj(r.script)
  if (script) {
    const sc: Record<string, unknown> = {}
    if (typeof script.openingTitleOnly === 'boolean') sc.openingTitleOnly = script.openingTitleOnly
    if (typeof script.titleInOpening === 'boolean') sc.titleInOpening = script.titleInOpening
    const seg = clampNum(script.titleSegment, 1, 9)
    if (seg !== undefined) sc.titleSegment = Math.round(seg)
    if (typeof script.chineseTitlesOnly === 'boolean') sc.chineseTitlesOnly = script.chineseTitlesOnly
    // 附加规则封顶 2000 字（parseTemplateParams 同样会截断，这里先拦一道给出确定行为）
    if (typeof script.extraRules === 'string') sc.extraRules = script.extraRules.slice(0, 2000)
    const cmax = clampNum(script.captionMaxChars, 6, 24)
    if (cmax !== undefined) sc.captionMaxChars = Math.round(cmax)
    if (Object.keys(sc).length) out.script = sc
  }

  return Object.keys(out).length ? out : null
}
