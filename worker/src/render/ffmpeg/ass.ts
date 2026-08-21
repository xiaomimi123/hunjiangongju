// 文字层：正文字幕 + 常驻《书名》大标题 + 水印，全部收敛到**一个 ASS 文件**。
//
// 为什么不用 drawtext：drawtext 每段文字要一个滤镜实例、时序靠 enable='between(t,a,b)'
// 表达式拼、换行与居中要自己算像素。本片仅正文字幕就有 24 条，再加书名段与水印，
// 滤镜链会长到无法阅读。ASS 一个文件搞定时序、字体、描边、对齐、换行，
// 滤镜链里只留一个 subtitles=。
//
// 纯函数：只产出文件内容字符串。写盘与拼命令由调用方负责。

export interface AssCue {
  text: string
  startMs: number
  endMs: number
}

/** 快闪书封卡上的书名/作者。与正文字幕分开是因为排版完全不同：居中大字、无压暗底。 */
export interface AssFlashCue {
  title: string
  author?: string
  startMs: number
  endMs: number
}

export interface AssStyleOpts {
  /** ASS 的 Fontname 用的是**字体内部族名**，不是文件名。容器里装了 fonts-noto-cjk。 */
  fontName: string
  /** 正文字幕颜色，#rrggbb */
  captionColor: string
  /** 正文字幕竖直位置，0..1（相对画面高度，指字幕基线所在位置） */
  captionPosY: number
  captionSizePx: number
  /** 常驻《书名》大标题 */
  titleSizePx: number
  titleColor: string
  /** 水印 */
  watermarkSizePx: number
  /** 快闪书封卡（不给则不产出快闪样式） */
  flashTitleSizePx?: number
  flashTitleColor?: string
  flashAuthorSizePx?: number
  flashAuthorColor?: string
  /**
   * 各文字层的竖直位置（距画面顶端的归一化高度），来自草稿实测。
   *
   * 之前这三处是写死在渲染层的：常驻大标题贴在顶边(an8, 边距 48px ≈ 5%)、
   * 快闪书名固定 50%、作者 62%。而草稿实测是 21.8% / 16.9%——差得很远。
   */
  titlePosY?: number
  flashTitlePosY?: number
  /** 开场标题「今天分享的是…」。缺省则不渲染该层（老调用零回归）。 */
  openTitleSizePx?: number
  openTitleColor?: string
  openTitlePosY?: number
}

export interface AssOpts {
  width: number
  height: number
  captions: AssCue[]
  /** 常驻《书名》大标题，按连续同书名合并后的运行段 */
  bookTitles?: AssCue[]
  /** 快闪书封卡，时间用**全片绝对值** */
  flashCards?: AssFlashCue[]
  /** 开场标题。ffmpeg 迁移时整段被 segs.slice(1) 丢掉了，成片开头一直没有这行字。 */
  openTitle?: AssCue
  /** 全片水印文字；空则不渲染 */
  watermark?: string
  totalMs: number
  style: AssStyleOpts
}

/**
 * #rrggbb → ASS 的 &HAABBGGRR。
 *
 * 三个坑一次踩全：**通道顺序是 BGR 反的**、**alpha 在最前**、
 * 而且 ASS 的 alpha 是**透明度**不是不透明度（00 = 完全不透明，FF = 全透明）。
 * 直接把 #ffffff 塞进去会得到错误颜色，且往往还「看起来能用」——白色正反都一样，
 * 等换成有色字幕才暴露。所以这里必须转换，不能图省事。
 */
export function toAssColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  const rgb = m ? m[1] : 'ffffff'
  const r = rgb.slice(0, 2)
  const g = rgb.slice(2, 4)
  const b = rgb.slice(4, 6)
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, '0')
  return `&H${a}${b}${g}${r}`.toUpperCase()
}

/**
 * 毫秒 → ASS 时间码 `H:MM:SS.cc`。
 * **是百分秒两位，不是毫秒三位**——写成三位 libass 会解析出错位的时间。
 */
export function toAssTime(ms: number): string {
  const t = Math.max(0, Math.round(ms))
  const cs = Math.floor((t % 1000) / 10)
  const s = Math.floor(t / 1000) % 60
  const m = Math.floor(t / 60000) % 60
  const h = Math.floor(t / 3600000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`
}

/**
 * 事件文本转义。
 * `{` `}` 是覆盖标签的定界符、`\` 是转义符——原样写进去会被 libass 当指令吃掉
 * （文案里出现「\」或「{」不是没可能）。换行统一成 `\N`（硬换行）。
 */
export function escapeAssText(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
    .trim()
}

/**
 * 按可用宽度把字号缩下来，避免长标题溢出画面。
 *
 * 中日韩字符按「一字一个字号宽」估，ASCII 按半个——这是等宽近似，不精确，
 * 但字幕层只需要"不溢出"，宁可略小。剪映自己也是这么处理的：
 * 同一层的 clip.scale 随书名长度从 1.407 缩到 0.698。
 */
/** 常驻大标题里作者行相对书名的字号比例（与快闪卡的作者行同一口径） */
const TITLE_SUB_RATIO = 0.42

/**
 * 常驻大标题的「加粗层」描边宽度。
 *
 * 自带字体只有 NotoSansSC-Regular，**没有粗体字面**，而 libass 不会为它合成假粗体
 * ——实测同一段文字 Bold=0 与 Bold=1 渲染出来完全一致，那个标志位一直是摆设。
 * 所以真加粗只能自己做：在原字上再叠一层「与文字同色」的细描边，把笔画撑粗。
 * 底层保留深色粗描边（浅色配图上的可读性靠它），加粗层压在上面。
 */
const TITLE_BOLD_BORD = 1.6

/** 内联覆盖标签用的颜色格式：&HBBGGRR&（与样式行的 &HAABBGGRR 不同，少一个 alpha） */
function inlineColor(hex: string): string {
  const full = toAssColor(hex) // &HAABBGGRR
  return `&H${full.slice(4)}&`
}

export function fitSizePx(text: string, basePx: number, widthPx: number, marginPx = 40): number {
  // ★ 按**最长的那一行**量，不是整串。
  // 第一版把整串当一行：常驻大标题的文本是「《书名》\N作者」，连 ASS 的换行转义一起算进去，
  // 于是 9 字的书名被当成 18 字，缩到 35px —— 比 54px 的正文字幕还小（线上实测）。
  // 真换行与 ASS 的 \N 都要切：调用点传的是**未转义**的原文（含真换行），
  // 只认 \N 的话换行符会被当成一个字算进宽度。
  const cells = text
    .split(/\r?\n|\\N/)
    .reduce((m, line) => Math.max(m, [...line].reduce((n, ch) => n + (ch.charCodeAt(0) < 0x2e80 ? 0.5 : 1), 0)), 0)
  if (cells <= 0) return basePx
  const max = Math.floor((widthPx - marginPx * 2) / cells)
  return Math.max(18, Math.min(basePx, max))
}

export function buildAss(o: AssOpts): string {
  const st = o.style
  // 正文字幕：底部居中(an2)。posY 给的是「基线在画面高度的哪个位置」，
  // an2 的锚点在底边，所以边距 = 画面高 - 基线位置。
  const capMarginV = Math.max(0, Math.round(o.height * (1 - st.captionPosY)))

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    // PlayRes 必须等于视频尺寸。缺省时 libass 按 384x288 换算，
    // 所有字号与边距会整体缩放到面目全非——这个坑不会报错，只会"字莫名其妙的小"。
    `PlayResX: ${o.width}`,
    `PlayResY: ${o.height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // 描边 + 阴影：配图明暗不可控，没有描边的字幕在浅色图上会糊掉
    `Style: cap,${st.fontName},${st.captionSizePx},${toAssColor(st.captionColor)},${toAssColor('#ffffff')},${toAssColor('#000000')},${toAssColor('#000000', 128)},0,0,0,0,100,100,0,0,1,3,2,2,60,60,${capMarginV},1`,
    // an5(正中) + \pos：位置由草稿的 titlePosY 决定，不再贴死在顶边
    `Style: title,${st.fontName},${st.titleSizePx},${toAssColor(st.titleColor)},${toAssColor('#ffffff')},${toAssColor('#000000')},${toAssColor('#000000', 160)},1,0,0,0,100,100,0,0,1,3,2,5,40,40,0,1`,
    ...(st.openTitleSizePx
      ? [`Style: ot,${st.fontName},${st.openTitleSizePx},${toAssColor(st.openTitleColor ?? '#ffffff')},${toAssColor('#ffffff')},${toAssColor('#000000')},${toAssColor('#000000', 160)},1,0,0,0,100,100,0,0,1,3,2,5,40,40,0,1`]
      : []),
    `Style: wm,${st.fontName},${st.watermarkSizePx},${toAssColor('#ffffff', 96)},${toAssColor('#ffffff')},${toAssColor('#000000', 96)},${toAssColor('#000000', 200)},0,0,0,0,100,100,0,0,1,2,0,9,24,24,24,1`,
    // 快闪卡：an5(正中) + \pos 精确定位。只在给了尺寸时产出，老调用零回归。
    ...(st.flashTitleSizePx
      ? [
          `Style: ft,${st.fontName},${st.flashTitleSizePx},${toAssColor(st.flashTitleColor ?? '#ffffff')},${toAssColor('#ffffff')},${toAssColor('#000000')},${toAssColor('#000000', 180)},1,0,0,0,100,100,0,0,1,3,3,5,40,40,0,1`,
          `Style: fa,${st.fontName},${st.flashAuthorSizePx ?? 28},${toAssColor(st.flashAuthorColor ?? '#ffcc88')},${toAssColor('#ffffff')},${toAssColor('#000000')},${toAssColor('#000000', 180)},1,0,0,0,100,100,0,0,1,2,2,5,40,40,0,1`,
        ]
      : []),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const ev: string[] = []
  const line = (layer: number, c: AssCue, style: string) => {
    const text = escapeAssText(c.text)
    if (!text) return
    if (!(c.endMs > c.startMs)) return // 零长/负长事件 libass 直接不显示，早点丢掉更清楚
    ev.push(`Dialogue: ${layer},${toAssTime(c.startMs)},${toAssTime(c.endMs)},${style},,0,0,0,,${text}`)
  }

  // 快闪卡在最底层：它出现的时段里本来就没有正文字幕与常驻书名
  const cx = Math.round(o.width / 2)
  const fty = Math.round(o.height * (st.flashTitlePosY ?? 0.5))
  // 作者名压在书名下方一行：间距按书名字号取比例，换字号时不用重新标定
  const fay = Math.round(fty + (st.flashTitleSizePx ?? 58) * 0.95)
  for (const c of o.flashCards ?? []) {
    if (!(c.endMs > c.startMs)) continue
    const t = escapeAssText(`《${c.title}》`)
    // 长书名按可用宽度缩排：剪映就是这么干的（实测同一层 scale 从 1.407 缩到 0.698）。
    // 不缩的话《我们生活在巨大的差距里》会溢出画面两侧。
    if (t) {
      const fs = fitSizePx(`《${c.title}》`, st.flashTitleSizePx ?? 58, o.width)
      ev.push(`Dialogue: 0,${toAssTime(c.startMs)},${toAssTime(c.endMs)},ft,,0,0,0,,{\\pos(${cx},${fty})\\fs${fs}}${t}`)
    }
    const a = escapeAssText(c.author ?? '')
    if (a) ev.push(`Dialogue: 0,${toAssTime(c.startMs)},${toAssTime(c.endMs)},fa,,0,0,0,,{\\pos(${cx},${fay})}${a}`)
  }
  if (o.openTitle && st.openTitleSizePx && o.openTitle.endMs > o.openTitle.startMs) {
    const t = escapeAssText(o.openTitle.text)
    const oy = Math.round(o.height * (st.openTitlePosY ?? 0.81))
    if (t) ev.push(`Dialogue: 0,${toAssTime(o.openTitle.startMs)},${toAssTime(o.openTitle.endMs)},ot,,0,0,0,,{\\pos(${cx},${oy})}${t}`)
  }
  const ty = Math.round(o.height * (st.titlePosY ?? 0.22))
  for (const c of o.bookTitles ?? []) {
    if (!(c.endMs > c.startMs)) continue
    // 书名与作者**各取各的字号**：合在一起量宽度时，长作者名会把书名一起拖小
    // （线上实测「《被讨厌的勇气》/岸见一郎、古贺史健」把 100px 拖到 35px，比正文还小）。
    // 草稿里的常驻大标题本来就只有书名、没有作者。
    const [head = '', ...rest] = c.text.split(/\r?\n/)
    const headFs = fitSizePx(head, st.titleSizePx, o.width)
    const subFs = Math.round(st.titleSizePx * TITLE_SUB_RATIO)
    const parts = [`{\\fs${headFs}}${escapeAssText(head)}`]
    for (const line of rest) {
      if (line.trim()) parts.push(`{\\fs${fitSizePx(line, subFs, o.width)}}${escapeAssText(line)}`)
    }
    if (!escapeAssText(head)) continue
    const body = parts.join('\\N')
    ev.push(`Dialogue: 0,${toAssTime(c.startMs)},${toAssTime(c.endMs)},title,,0,0,0,,{\\pos(${cx},${ty})}${body}`)
    // 加粗层：同色细描边把笔画撑粗（见 TITLE_BOLD_BORD）。
    // 关掉阴影，否则阴影会被画两遍、显得脏。
    ev.push(
      `Dialogue: 1,${toAssTime(c.startMs)},${toAssTime(c.endMs)},title,,0,0,0,,` +
      `{\\pos(${cx},${ty})\\bord${TITLE_BOLD_BORD}\\shad0\\3c${inlineColor(st.titleColor)}}${body}`,
    )
  }
  for (const c of o.captions) line(1, c, 'cap')
  if (o.watermark && o.watermark.trim() && o.totalMs > 0) {
    line(2, { text: o.watermark, startMs: 0, endMs: o.totalMs }, 'wm')
  }

  return `${header.join('\n')}\n${ev.join('\n')}\n`
}

/**
 * 拼 subtitles 滤镜。
 *
 * 路径里的 `:` `'` `\` 会把滤镜表达式解析坏（macOS/Linux 的临时目录一般安全，
 * 但任务目录来自用户数据，不能假设）。ffmpeg 的转义规则是先转义反斜杠再转义冒号。
 * @param fontsDir 自带字体目录；缺省则走系统 fontconfig（容器里有 fonts-noto-cjk）
 */
export function subtitlesFilter(assAbs: string, fontsDir?: string): string {
  const esc = (p: string) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
  const fd = fontsDir ? `:fontsdir='${esc(fontsDir)}'` : ''
  return `subtitles='${esc(assAbs)}'${fd}`
}
