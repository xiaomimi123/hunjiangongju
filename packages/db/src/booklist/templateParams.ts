// booklist 模板参数：结构/节奏/转场/字幕/快闪/音效。默认值=从客户剪映工程解出的配方。
// P2 学习器将产出同结构对象填 framework.overlayTemplate.__templateParams。

import type { MoveId } from './draftMotion'

export type TemplateMode = 'classic' | 'flash'

export interface GradeParams { filterName: string; intensity: number; contrast: number; sharpen: boolean }

export interface TemplateParams {
  mode: TemplateMode
  open: { durationMs: number; shatter: boolean; titleText: string; sfx: boolean }
  // hardCut：快闪卡之间瞬时切换、不做淡入。可选字段，缺省即维持既有的 0.12s 淡入，老框架零回归。
  // 依据是草稿的快闪段边界上有无转场素材（实测原工程是硬切，而我们一直在加淡入）。
  // clipMs：草稿里每张快闪卡的实际时长序列。原工程各卡长短不一（如 150/251/195/191…），
  // 而 flashTimeline 原本用 win/count 等分窗口，九张卡必然等间隔——实测成片切点偏差最大 58.7ms
  // （近两帧）。有此字段时按其**相对比例**排布（窗口长度由第0段配音时长决定，未必等于草稿，
  // 所以只能保比例不能照抄绝对毫秒；长短相间的律动才是卡点的本质）。
  flash: { perClipMs: number; minClipMs: number; bounceIn: boolean; titleFontFamily: string; scale?: number; hardCut?: boolean; clipMs?: number[] }
  // enterBodyHardCut：快闪→正片那一刀是不是硬切（实测样例即是）。
  // bodyCycle：正片**内部**边界的实测转场，按序循环套用到我们的正片边界上。
  // 分开表达而不是合成一个序列——正片段数与草稿不等，若把"进正片那一刀"混进循环，
  // 循环回绕时会在正片中间冒出一个原片没有的硬切。两者分开就没有这个假象。
  // 阶段2槽位对齐后可升级为真正的逐边界，届时这两个字段合并。
  transition: {
    type: 'dissolve'
    durationMs: number
    enterBodyHardCut?: boolean
    bodyCycle?: { renderType: 'crossfade' | 'wipe' | 'shard' | 'glide-push' | 'blur-dissolve'; durationMs: number }[]
  }
  // slotDurationsMs：草稿各正片段的实测时长。
  // 段时长原先完全由 TTS 时长累加决定，而 TTS 时长由每段字数决定，字数预算又只有一个全局总数
  // ——LLM 想怎么分就怎么分。实测成片正片三段是 3.6/4.2/9.4 秒（最后一张图挂了 9.4 秒），
  // 草稿是 5.7/8.1/6.1。有了逐段时长才能按比例分配字数、进而把节奏拉回草稿。
  body: { subtitleFontFamily: string; subtitleColor: string; subtitlePosY: number; kenBurns: 'subtle' | 'off'; photoScale?: number; subtitleEntrance?: string; slotDurationsMs?: number[] }
  // bgmStartMs / bgmFadeInMs / bgmFadeOutMs：默认全 0 = 从头播、不淡入淡出，与加这三个字段
  // 之前的行为逐字节一致。BGM 输入带 -stream_loop -1，所以 bgmStartMs 落在循环后的时间轴上，
  // 取值超过曲长也不会取空（会取到下一轮的对应位置）。
  // script：文案口径。这些规则原先写死在 generateScript.ts 的提示词里——
  // 「开场白不得出现书名」「第二段以《书名》开头」这类要求每变一次都要改代码。
  // 现在做成结构化开关 + 自由规则文本；默认值 = 现行提示词的口径，老框架零回归。
  script?: {
    /**
     * 开场白**只念开场标题本身**（如「今天分享的是」六个字），不加任何其它话。
     *
     * 客户原工程的人声轨就是这么剪的：开场 1.8 秒只有这六个字，快闪期间静默，
     * 书名单独念，正文再进。此前提示词要求"以标题开头 + 一句话点出问题"，
     * 而那句话不受任何硬约束（配额是建议、重排跳过开场白、变速兜不满），
     * AI 一写长就吃进快闪窗口——线上反馈的「停顿感没了」就是这么来的。
     * 生成后有确定性兜底：开场段文本强制替换为标题原文（见 generateScript）。
     */
    openingTitleOnly: boolean
    /** 开场白里允许出现书名（false = 书名留到 titleSegment 段才报出，对齐快闪揭晓的节奏） */
    titleInOpening: boolean
    /** 书名在第几段开头报出（1 起数；仅 titleInOpening=false 时生效） */
    titleSegment: number
    /** 只推荐中文书名的书（关掉则允许外文书） */
    chineseTitlesOnly: boolean
    /** 附加规则：逐行写给 AI 的额外要求（如"结尾必须反问""不要出现数字"），原样进提示词 */
    extraRules: string
    /**
     * 每拍字幕的最多字数。超过就在标点处再切、无标点则硬切。
     * 从 16 收到 12：线上反馈整行字幕太满（"一次讲述那么多内容"），
     * 12 字在 720 宽画布 54px 字号下约占画面 90%，再长就顶边了。
     */
    captionMaxChars: number
  }
  // pace：节奏留白与语速。原先是代码常量（draftCharBudget.ts / generateTts.ts），
  // 「开场白说完停顿」「书名前留白 0.4 秒」「换音色后语速标定」这些反馈都落在它们身上。
  // 默认值 = 原常量值，老框架零回归。
  pace?: {
    /** 正片第 1 段报书名前的留白（ms）。0 = 书名紧贴快闪出口 */
    bookTitleLeadMs: number
    /**
     * 书名念完之后、正文开口之前的停顿（ms）。
     * 原工程书名是独立的一小段人声，念完停约 200~400ms 才进正文；
     * 我们此前把书名和正文连成一次合成，中间只有个逗号——听感就是"赶"。
     */
    bookTitleTailMs: number
    /** 配音语速（字/秒），用来推字数预算。换音色后要重新标定（看 worker 日志里的逐段时长） */
    speechCharsPerSec: number
    /** 配音超槽位时保音高变速的上限。1 = 不许变速（超出就让画面变长） */
    maxTempo: number
  }
  audio: {
    bgmVolume: number
    bgmStartMs: number
    bgmFadeInMs: number
    bgmFadeOutMs: number
    sfx: { openGear: boolean; transitionDrop: boolean }
  }
  grade?: GradeParams
  // keyframes：从草稿 common_keyframes 提取的**实测**运镜数值（阶段1只含缩放）。
  // 与 moves 的区别：moves 是把曲线归类成 6 种预设招式、幅度硬编码；keyframes 是照抄原值。
  // 两者并存：keyframes 非空时优先，为空时回退 moves，老框架零回归。
  motion?: { moves: MoveId[]; keyframes?: { scaleFrom: number; scaleTo: number }[] }
  // effects：草稿 effect 轨上的特效。目前只支持水波纹（样例里唯一出现的一种）。
  // ripple.offsetMs 是**相对快闪结束那一刀**的偏移，不是绝对时间——我们的分镜时长由 TTS
  // 决定、与草稿不等长，照搬绝对秒数必然落在别的画面上。理由详见 draftEffects.ts:deriveRipple。
  effects?: { ripple?: { offsetMs: number; durationMs: number } }
  /**
   * 文字层的位置与相对字号。
   *
   * **位置**是「距画面顶端的归一化高度」，与 body.subtitlePosY 同口径（transformYToNorm）。
   * 之前只提取了正文字幕这一处，开场标题/快闪书名/常驻大标题全是渲染层拍脑袋定的，
   * 实测与草稿差得很远：常驻大标题草稿在 21.8%、我们贴在 5%；快闪书名草稿在 16.9%、
   * 我们放在 50%。
   *
   * **字号是相对正文字幕的倍数，不是绝对像素。** 剪映的 size 单位与渲染像素之间没有
   * 可逆换算（这一条在迁移设计里就写明了），但同一份草稿内各文字层的相对大小是可靠的：
   * 有效字号 = size × clip.scale。实测常驻大标题是正文的 1.85 倍，而我们是 1.09 倍。
   */
  // 下面这批原先写死在渲染层（fromBodyData.ts / ass.ts 的常量），线上反馈
  // 「字太小」「标题要加粗放大」「描边看不清」全落在它们身上——每次都要改代码。
  // 现在收进参数，默认值 = 原写死值，老框架逐字节不变。
  text?: {
    openTitlePosY: number
    openTitleScale: number
    flashTitlePosY: number
    flashTitleScale: number
    bookTitlePosY: number
    bookTitleScale: number
    /** 正文字幕基准字号（px）。其余各层字号 = 它 × 各自的 Scale */
    captionSizePx: number
    /** 常驻大标题在 bookTitleScale 之上再放大的系数（产品要求"再大一些"时调它） */
    bookTitleBoost: number
    /** 所有文字层的描边宽度（px）。浅底图上字看不清时调大 */
    outlinePx: number
    /** 常驻大标题加粗层的同色描边宽度。0 = 不加粗 */
    boldBordPx: number
    /** 正文字幕渐入/渐出时长（ms）。0 = 瞬间出现（旧行为） */
    captionFadeInMs: number
    captionFadeOutMs: number
    /** 各层颜色（#rrggbb） */
    bookTitleColor: string
    flashTitleColor: string
    flashAuthorColor: string
    openTitleColor: string
    /** 双语字幕总开关。false = 完全不渲染英文（老框架零回归） */
    bilingual: boolean
    /** 英文行字号 = captionSizePx × enScale */
    enScale: number
    /** 英文行颜色 #rrggbb */
    enColor: string
    /** 中英两行的额外行间距（px） */
    enGapPx: number
  }
}

/** 渲染器实际支持的转场类型白名单（与 worker/templates/booklist/motion.ts 的 TransId 对齐） */
export const TRANS_RENDER_TYPES = ['crossfade', 'wipe', 'shard', 'glide-push', 'blur-dissolve'] as const

export const DEFAULT_PARAMS: TemplateParams = {
  mode: 'classic',
  open: { durationMs: 2160, shatter: true, titleText: '今天分享的是', sfx: true },
  flash: { perClipMs: 200, minClipMs: 120, bounceIn: true, titleFontFamily: 'flash-title' },
  transition: { type: 'dissolve', durationMs: 400 },
  body: { subtitleFontFamily: 'subtitle', subtitleColor: '#ffffff', subtitlePosY: 0.78, kenBurns: 'subtle' },
  script: { openingTitleOnly: true, titleInOpening: false, titleSegment: 2, chineseTitlesOnly: true, extraRules: '', captionMaxChars: 12 },
  pace: { bookTitleLeadMs: 400, bookTitleTailMs: 300, speechCharsPerSec: 5.5, maxTempo: 1.25 },
  audio: { bgmVolume: 0.69, bgmStartMs: 0, bgmFadeInMs: 0, bgmFadeOutMs: 0, sfx: { openGear: true, transitionDrop: true } },
  // 按客户样例草稿实测标定（今天分享的是/draft_content.json，720×960）。
  // 给默认值而不是留空：库里已有的框架是在这个字段存在之前导入的，留空它们会继续用
  // 旧的拍脑袋位置；而它们本来就是同一份模板导入的，用实测值只会更准。
  text: {
    openTitlePosY: 0.811, openTitleScale: 1.13,
    flashTitlePosY: 0.169, flashTitleScale: 1.96,
    bookTitlePosY: 0.218, bookTitleScale: 1.85,
    // 与原渲染层写死值一致（fromBodyData.ts 的 CAPTION_PX/TITLE_BOOST、ass.ts 的描边）
    captionSizePx: 54, bookTitleBoost: 1.3, outlinePx: 3, boldBordPx: 1.6,
    captionFadeInMs: 200, captionFadeOutMs: 120,
    bookTitleColor: '#ffe9c0', flashTitleColor: '#ffffff',
    flashAuthorColor: '#ffcc88', openTitleColor: '#ffffff',
    bilingual: false, enScale: 0.6, enColor: '#dddddd', enGapPx: 8,
  },
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function num(v: unknown, d: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : d }
function str(v: unknown, d: string): string { return typeof v === 'string' && v.trim() ? v : d }
function bool(v: unknown, d: boolean): boolean { return typeof v === 'boolean' ? v : d }

export function parseTemplateParams(raw: unknown): TemplateParams {
  const r = obj(raw)
  const D = DEFAULT_PARAMS
  const open = obj(r.open), flash = obj(r.flash), tr = obj(r.transition), body = obj(r.body)
  const audio = obj(r.audio), sfx = obj(audio.sfx)
  return {
    mode: r.mode === 'flash' ? 'flash' : 'classic',
    open: {
      durationMs: num(open.durationMs, D.open.durationMs),
      shatter: bool(open.shatter, D.open.shatter),
      titleText: str(open.titleText, D.open.titleText),
      sfx: bool(open.sfx, D.open.sfx),
    },
    flash: {
      perClipMs: num(flash.perClipMs, D.flash.perClipMs),
      minClipMs: num(flash.minClipMs, D.flash.minClipMs),
      bounceIn: bool(flash.bounceIn, D.flash.bounceIn),
      titleFontFamily: str(flash.titleFontFamily, D.flash.titleFontFamily),
      ...(typeof flash.scale === 'number' && Number.isFinite(flash.scale) ? { scale: flash.scale } : {}),
      ...(typeof flash.hardCut === 'boolean' ? { hardCut: flash.hardCut } : {}),
      ...(Array.isArray(flash.clipMs)
        ? {
            clipMs: (flash.clipMs as unknown[]).filter(
              (x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0,
            ),
          }
        : {}),
    },
    transition: {
      type: 'dissolve',
      durationMs: num(tr.durationMs, D.transition.durationMs),
      ...(typeof tr.enterBodyHardCut === 'boolean' ? { enterBodyHardCut: tr.enterBodyHardCut } : {}),
      ...(Array.isArray(tr.bodyCycle)
        ? {
            bodyCycle: (tr.bodyCycle as unknown[])
              .map((x) => obj(x))
              // renderType 必须落在渲染器支持的五种之内。只校验"是字符串"不够——
              // transTweens 的 switch 没有 default，非法值会静默返回空串，
              // 表现为"那条边界悄悄没了转场"，不报错、不崩，回放时才发现节奏不对。
              .filter(
                (x) =>
                  typeof x.durationMs === 'number' &&
                  Number.isFinite(x.durationMs) &&
                  typeof x.renderType === 'string' &&
                  (TRANS_RENDER_TYPES as readonly string[]).includes(x.renderType),
              )
              .map((x) => ({ renderType: x.renderType as (typeof TRANS_RENDER_TYPES)[number], durationMs: x.durationMs as number })),
          }
        : {}),
    },
    body: {
      subtitleFontFamily: str(body.subtitleFontFamily, D.body.subtitleFontFamily),
      subtitleColor: str(body.subtitleColor, D.body.subtitleColor),
      subtitlePosY: num(body.subtitlePosY, D.body.subtitlePosY),
      kenBurns: body.kenBurns === 'off' ? 'off' : 'subtle',
      ...(typeof body.photoScale === 'number' && Number.isFinite(body.photoScale) ? { photoScale: body.photoScale } : {}),
      ...(typeof body.subtitleEntrance === 'string' && body.subtitleEntrance ? { subtitleEntrance: body.subtitleEntrance } : {}),
      ...(Array.isArray(body.slotDurationsMs)
        ? {
            slotDurationsMs: (body.slotDurationsMs as unknown[]).filter(
              (x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0,
            ),
          }
        : {}),
    },
    script: (() => {
      const sc = obj(r.script)
      const DS = D.script!
      const seg = num(sc.titleSegment, DS.titleSegment)
      return {
        openingTitleOnly: bool(sc.openingTitleOnly, DS.openingTitleOnly),
        titleInOpening: bool(sc.titleInOpening, DS.titleInOpening),
        // 夹在 1~9：0/负数没有意义，超过段数时调用方按"最后一段"处理
        titleSegment: Math.min(9, Math.max(1, Math.round(seg))),
        chineseTitlesOnly: bool(sc.chineseTitlesOnly, DS.chineseTitlesOnly),
        // 规则文本封顶 2000 字：提示词不是垃圾场，写超说明该去改框架文案本体
        extraRules: str(sc.extraRules, DS.extraRules).slice(0, 2000),
        // 夹在 6~24：低于 6 会把词切碎，高于 24 一行铺满画面
        captionMaxChars: Math.min(24, Math.max(6, Math.round(num(sc.captionMaxChars, DS.captionMaxChars)))),
      }
    })(),
    pace: (() => {
      const pc = obj(r.pace)
      const DP = D.pace!
      const rate = num(pc.speechCharsPerSec, DP.speechCharsPerSec)
      const tempo = num(pc.maxTempo, DP.maxTempo)
      return {
        bookTitleLeadMs: Math.max(0, num(pc.bookTitleLeadMs, DP.bookTitleLeadMs)),
        bookTitleTailMs: Math.max(0, num(pc.bookTitleTailMs, DP.bookTitleTailMs)),
        // 语速夹在 2~12：离谱值宁可回默认，也不让字数预算被脏数据带跑
        speechCharsPerSec: rate >= 2 && rate <= 12 ? rate : DP.speechCharsPerSec,
        // 变速上限夹在 1~2：低于 1 会变成拉长（那是补静音的事），高于 2 是机关枪
        maxTempo: Math.min(2, Math.max(1, tempo)),
      }
    })(),
    audio: {
      bgmVolume: num(audio.bgmVolume, D.audio.bgmVolume),
      // 负值一律归零：负的起点/淡化时长会让 ffmpeg 的 atrim/afade 产出空流或整段静音，
      // 而那是一路"看起来在混音、实际没声音"的输入，排查起来毫无线索。
      bgmStartMs: Math.max(0, num(audio.bgmStartMs, D.audio.bgmStartMs)),
      bgmFadeInMs: Math.max(0, num(audio.bgmFadeInMs, D.audio.bgmFadeInMs)),
      bgmFadeOutMs: Math.max(0, num(audio.bgmFadeOutMs, D.audio.bgmFadeOutMs)),
      sfx: { openGear: bool(sfx.openGear, D.audio.sfx.openGear), transitionDrop: bool(sfx.transitionDrop, D.audio.sfx.transitionDrop) },
    },
    // 文字层位置/相对字号：逐字段回退，缺哪个补哪个。
    // 整块回退是错的——老框架只会缺这一整块，而部分导入可能只取到其中几项。
    text: (() => {
      const t = obj(r.text)
      const DT = D.text!
      return {
        openTitlePosY: num(t.openTitlePosY, DT.openTitlePosY),
        openTitleScale: num(t.openTitleScale, DT.openTitleScale),
        flashTitlePosY: num(t.flashTitlePosY, DT.flashTitlePosY),
        flashTitleScale: num(t.flashTitleScale, DT.flashTitleScale),
        bookTitlePosY: num(t.bookTitlePosY, DT.bookTitlePosY),
        bookTitleScale: num(t.bookTitleScale, DT.bookTitleScale),
        captionSizePx: num(t.captionSizePx, DT.captionSizePx),
        bookTitleBoost: num(t.bookTitleBoost, DT.bookTitleBoost),
        outlinePx: num(t.outlinePx, DT.outlinePx),
        boldBordPx: num(t.boldBordPx, DT.boldBordPx),
        captionFadeInMs: Math.max(0, num(t.captionFadeInMs, DT.captionFadeInMs)),
        captionFadeOutMs: Math.max(0, num(t.captionFadeOutMs, DT.captionFadeOutMs)),
        bookTitleColor: str(t.bookTitleColor, DT.bookTitleColor),
        flashTitleColor: str(t.flashTitleColor, DT.flashTitleColor),
        flashAuthorColor: str(t.flashAuthorColor, DT.flashAuthorColor),
        openTitleColor: str(t.openTitleColor, DT.openTitleColor),
        bilingual: bool(t.bilingual, DT.bilingual),
        enScale: num(t.enScale, DT.enScale),
        enColor: str(t.enColor, DT.enColor),
        enGapPx: Math.max(0, num(t.enGapPx, DT.enGapPx)),
      }
    })(),
    ...(r.grade && typeof r.grade === 'object' && !Array.isArray(r.grade)
      ? { grade: {
          filterName: str((r.grade as Record<string, unknown>).filterName, ''),
          intensity: num((r.grade as Record<string, unknown>).intensity, 0),
          contrast: num((r.grade as Record<string, unknown>).contrast, 0),
          sharpen: bool((r.grade as Record<string, unknown>).sharpen, false),
        } }
      : {}),
    ...(Array.isArray(obj(r.motion).moves)
      ? {
          motion: {
            moves: (obj(r.motion).moves as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) as MoveId[],
            // keyframes 只收「两端都是有限数」的条目，脏项静默丢弃而非让整块 motion 失效
            ...(Array.isArray(obj(r.motion).keyframes)
              ? {
                  keyframes: (obj(r.motion).keyframes as unknown[])
                    .map((k) => obj(k))
                    .filter((k) => typeof k.scaleFrom === 'number' && Number.isFinite(k.scaleFrom) && typeof k.scaleTo === 'number' && Number.isFinite(k.scaleTo))
                    .map((k) => ({ scaleFrom: k.scaleFrom as number, scaleTo: k.scaleTo as number })),
                }
              : {}),
          },
        }
      : {}),
    // effects.ripple：两个字段都必须是有限数才收，脏项整块丢弃（缺一个就无法定位/定长）
    ...(() => {
      const rp = obj(obj(r.effects).ripple)
      return typeof rp.offsetMs === 'number' && Number.isFinite(rp.offsetMs) &&
        typeof rp.durationMs === 'number' && Number.isFinite(rp.durationMs) && rp.durationMs > 0
        ? { effects: { ripple: { offsetMs: rp.offsetMs, durationMs: rp.durationMs } } }
        : {}
    })(),
  }
}

export interface FlashTimeline {
  openEndMs: number
  flashEndMs: number
  perClipMs: number
  count: number
  /** 各卡相对 openEndMs 的起点偏移(ms)；仅在草稿提供逐卡时长时存在，否则用 perClipMs 等分 */
  offsets?: number[]
}

// 快闪落在第 0 段时间窗内：开场 [0,openEndMs] + 快闪 [openEndMs,seg0EndMs] 均分 N 本。
export function flashTimeline(p: TemplateParams, seg0EndMs: number, bookCount: number): FlashTimeline {
  const openEndMs = Math.round(Math.min(p.open.durationMs, seg0EndMs * 0.55))
  const count = Math.max(0, bookCount)
  if (count === 0) return { openEndMs, flashEndMs: seg0EndMs, perClipMs: 0, count: 0 }
  const win = Math.max(0, seg0EndMs - openEndMs)
  const perClipMs = Math.max(p.flash.minClipMs, win / count)

  // 逐卡时长：按相对比例缩放到实际窗口。卡数多于草稿条目时循环复用比例。
  const raw = (p.flash.clipMs ?? []).filter((x) => Number.isFinite(x) && x > 0)
  if (raw.length > 0 && win > 0) {
    const weights = Array.from({ length: count }, (_, i) => raw[i % raw.length])
    const total = weights.reduce((a, b) => a + b, 0)
    if (total > 0) {
      const offsets: number[] = []
      let acc = 0
      for (const w of weights) {
        offsets.push(Math.round(acc))
        acc += (w / total) * win
      }
      return { openEndMs, flashEndMs: seg0EndMs, perClipMs, count, offsets }
    }
  }
  return { openEndMs, flashEndMs: seg0EndMs, perClipMs, count }
}

/**
 * 开场 + 快闪窗口的总时长（ms），即第 0 段文案要占的那一格槽位。
 *
 * 文案配额侧与配音补静音侧都要用它，写在这里避免两边各算一遍算出不同的值
 * ——那正是逐段配额错位一格的成因。
 *
 * 非 flash 模板、或草稿没给快闪卡时长时返回 0（调用方各自兜底）。
 */
export function openFlashWindowMs(p: TemplateParams): number {
  const flashTotalMs = (p.flash.clipMs ?? []).reduce((a, b) => a + b, 0)
  return p.mode === 'flash' && flashTotalMs > 0 ? p.open.durationMs + flashTotalMs : 0
}
