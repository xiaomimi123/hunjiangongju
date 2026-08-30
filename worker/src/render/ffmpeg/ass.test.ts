import { describe, it, expect } from 'vitest'
import { buildAss, toAssColor, toAssTime, escapeAssText, subtitlesFilter, type AssOpts } from './ass'

const style = {
  fontName: 'Noto Sans CJK SC',
  captionColor: '#ffffff',
  captionPosY: 0.78,
  captionSizePx: 44,
  titleSizePx: 56,
  titleColor: '#ffe9c0',
  watermarkSizePx: 22,
}
const base: AssOpts = {
  width: 720, height: 960, totalMs: 20000, style,
  captions: [{ text: '如果你总困在过往的遗憾', startMs: 4830, endMs: 7149 }],
  watermark: '@读书号',
}

// ASS 颜色的三个坑一次踩全：通道顺序是 BGR、alpha 在最前、
// 且 alpha 是**透明度**不是不透明度。白色正反都一样，所以必须用有色值验。
describe('toAssColor', () => {
  it('BGR 反序 + alpha 前置', () => {
    expect(toAssColor('#ff0000')).toBe('&H000000FF')   // 纯红 → BB=00 GG=00 RR=FF
    expect(toAssColor('#00ff00')).toBe('&H0000FF00')
    expect(toAssColor('#0000ff')).toBe('&H00FF0000')
  })
  it('alpha=0 表示完全不透明', () => {
    expect(toAssColor('#ffffff', 0)).toBe('&H00FFFFFF')
    expect(toAssColor('#ffffff', 255)).toBe('&HFFFFFFFF')
  })
  it('脏输入回退白色，不产出非法样式行', () => {
    expect(toAssColor('不是颜色')).toBe('&H00FFFFFF')
    expect(toAssColor('')).toBe('&H00FFFFFF')
  })
})

// 是百分秒两位，写成毫秒三位 libass 会解析出错位的时间
describe('toAssTime', () => {
  it('H:MM:SS.cc，百分秒两位', () => {
    expect(toAssTime(0)).toBe('0:00:00.00')
    expect(toAssTime(4830)).toBe('0:00:04.83')
    expect(toAssTime(65432)).toBe('0:01:05.43')
    expect(toAssTime(3723456)).toBe('1:02:03.45')
  })
  it('负数夹到 0', () => {
    expect(toAssTime(-500)).toBe('0:00:00.00')
  })
})

describe('escapeAssText', () => {
  it('花括号与反斜杠被转义（否则被当覆盖标签吃掉）', () => {
    // 输入是字面量 `{b}加粗\N`（含一个真实反斜杠）
    // 期望：反斜杠→`\\`、`{`→`\{`、`}`→`\}`
    expect(escapeAssText('{b}加粗\\N')).toBe('\\{b\\}加粗\\\\N')
  })
  it('换行统一成 \\N', () => {
    expect(escapeAssText('上句\n下句')).toBe('上句\\N下句')
  })
  it('null/undefined 不炸', () => {
    expect(escapeAssText(undefined as unknown as string)).toBe('')
  })
})

describe('buildAss', () => {
  const ass = buildAss(base)

  // PlayRes 缺省时 libass 按 384x288 换算，字号与边距整体走样。
  // 这个坑不报错，只表现为「字莫名其妙的小」。
  it('PlayRes 必须等于视频尺寸', () => {
    expect(ass).toContain('PlayResX: 720')
    expect(ass).toContain('PlayResY: 960')
  })

  it('三种样式齐备', () => {
    expect(ass).toContain('Style: cap,')
    expect(ass).toContain('Style: title,')
    expect(ass).toContain('Style: wm,')
  })

  it('字幕事件带正确时间码与文本', () => {
    expect(ass).toContain('Dialogue: 1,0:00:04.83,0:00:07.14,cap,,0,0,0,,如果你总困在过往的遗憾')
  })

  // 配图明暗不可控，没有描边的字幕在浅色图上会糊掉
  it('字幕带描边', () => {
    const cap = ass.split('\n').find((l) => l.startsWith('Style: cap,'))!
    // Format 里 Outline 在 BorderStyle 之后：...,1,3,2,2,60,60,MarginV,1
    expect(cap).toMatch(/,1,3,2,2,60,60,\d+,1$/)
  })

  it('posY 换算成 an2 的底边距', () => {
    const cap = buildAss({ ...base, style: { ...style, captionPosY: 0.75 } })
      .split('\n').find((l) => l.startsWith('Style: cap,'))!
    expect(cap).toContain(',240,1')  // 960*(1-0.75)
  })

  it('水印铺满全片', () => {
    expect(ass).toContain('Dialogue: 2,0:00:00.00,0:00:20.00,wm,')
  })

  it('无水印时不产出水印事件', () => {
    expect(buildAss({ ...base, watermark: '' })).not.toContain(',wm,,')
    expect(buildAss({ ...base, watermark: undefined })).not.toContain(',wm,,')
  })

  it('常驻书名走 title 样式，且层级低于字幕（字幕压在上面）', () => {
    const a = buildAss({ ...base, bookTitles: [{ text: '《简爱》', startMs: 3984, endMs: 20000 }] })
    // 位置改由草稿的 titlePosY 驱动（\pos），字号按书名长度缩排（\fs），
    // 所以不再是"裸文本"。之前贴死在顶边(an8/边距48px≈5%)，草稿实测是 21.8%。
    // \pos 定位 + 逐行 \fs（书名与作者各取各的字号，见「常驻大标题的字号」一组）
    expect(a).toMatch(/Dialogue: 0,0:00:03\.98,0:00:20\.00,title,,0,0,0,,\{\\pos\(\d+,\d+\)\}\{\\fs\d+\}《简爱》/)
  })

  // 零长/负长事件 libass 直接不显示；早点丢掉比产出一条永不生效的行清楚
  it('零长与空文本事件被丢弃', () => {
    const a = buildAss({ ...base, captions: [
      { text: '正常', startMs: 0, endMs: 1000 },
      { text: '零长', startMs: 2000, endMs: 2000 },
      { text: '倒挂', startMs: 4000, endMs: 3000 },
      { text: '   ', startMs: 5000, endMs: 6000 },
    ] })
    expect(a).toContain('正常')
    expect(a).not.toContain('零长')
    expect(a).not.toContain('倒挂')
    expect((a.match(/Dialogue:/g) ?? []).length).toBe(2) // 正常 + 水印
  })
})

// ★ 开场标题「今天分享的是…」在 ffmpeg 迁移时整段丢了：fromBodyData 用 segs.slice(1)
// 把第 0 段（开场+快闪那个时间窗）扔掉，而那行开场白正是第 0 段的字幕。
// 成片开头一直是没有字的，直到对比原工程才发现。
describe('buildAss —— 开场标题', () => {
  const withOpen = (extra: Partial<AssOpts> = {}) => buildAss({
    ...base,
    openTitle: { text: '今天分享的是', startMs: 0, endMs: 2159 },
    style: { ...base.style, openTitleSizePx: 61, openTitlePosY: 0.811 },
    ...extra,
  })

  it('渲染出开场标题，且落在草稿实测的竖直位置上', () => {
    const a = withOpen()
    expect(a).toContain('Style: ot,')
    // 0.811 × 960 = 779
    expect(a).toMatch(/Dialogue: 0,0:00:00\.00,0:00:02\.15,ot,,0,0,0,,\{\\pos\(360,779\)\}今天分享的是/)
  })

  it('没给开场标题字号时不产出该层（老调用零回归）', () => {
    const a = buildAss({ ...base, openTitle: { text: '今天分享的是', startMs: 0, endMs: 2159 } })
    expect(a).not.toContain('Style: ot,')
    expect(a).not.toContain('今天分享的是')
  })
})

// ★ 位置之前是写死在渲染层的：常驻大标题贴顶边(≈5%)、快闪书名固定 50%。
// 草稿实测是 21.8% / 16.9%，差得很远——这是"位置样式与原工程不一致"的根因。
describe('buildAss —— 文字层位置由草稿驱动', () => {
  it('常驻书名与快闪书名都按给定 posY 定位', () => {
    const a = buildAss({
      ...base,
      bookTitles: [{ text: '《活着》', startMs: 4000, endMs: 20000 }],
      flashCards: [{ title: '活着', author: '余华', startMs: 2159, endMs: 3000 }],
      style: { ...base.style, titlePosY: 0.218, flashTitlePosY: 0.169, flashTitleSizePx: 106 },
    })
    expect(a).toMatch(/,title,,0,0,0,,\{\\pos\(360,209\)/) // 0.218×960
    expect(a).toMatch(/,ft,,0,0,0,,\{\\pos\(360,162\)/) // 0.169×960
  })

  // 剪映按书名长短自动缩放（实测同一层 scale 从 1.407 缩到 0.698）。
  // 不缩的话《我们生活在巨大的差距里》会溢出画面两侧。
  it('长书名按可用宽度缩排，短的保持基准字号', () => {
    const a = buildAss({
      ...base,
      flashCards: [
        { title: '活着', startMs: 2159, endMs: 2500 },
        { title: '我们生活在巨大的差距里', startMs: 2500, endMs: 3000 },
      ],
      style: { ...base.style, flashTitleSizePx: 106, flashTitlePosY: 0.169 },
    })
    const sizes = [...a.matchAll(/,ft,,0,0,0,,\{\\pos\([^)]+\)\\fs(\d+)\}/g)].map((m) => Number(m[1]))
    expect(sizes[0], '短书名不该被缩').toBe(106)
    expect(sizes[1], '长书名没缩，会溢出画面').toBeLessThan(106)
    // 13 个全角字(含《》)在 720 宽、左右各 40 边距下最多 49px
    expect(sizes[1]).toBeLessThanOrEqual(49)
  })
})

// ★ 线上实测：常驻大标题《被讨厌的勇气》比正文字幕还小。
// 原因是量宽度时把整串当一行——文本是「《书名》\n作者」，换行符与作者名一起算进去，
// 9 字的书名被当成 18 字，100px 缩到 35px。两处都要修：切行要认真换行符，
// 书名与作者各取各的字号。
describe('buildAss —— 常驻大标题的字号', () => {
  const titled = (text: string, titleSizePx = 100) => buildAss({
    ...base,
    bookTitles: [{ text, startMs: 4000, endMs: 20000 }],
    style: { ...base.style, titleSizePx, titlePosY: 0.218, captionSizePx: 54 },
  })
  const fsOf = (a: string) => [...a.matchAll(/\\fs(\d+)/g)].map((m) => Number(m[1]))

  it('作者行不再把书名拖小：书名按自己那行量宽度', () => {
    const one = fsOf(titled('《被讨厌的勇气》'))[0]
    const two = fsOf(titled('《被讨厌的勇气》\n岸见一郎、古贺史健'))[0]
    expect(two, '带作者时书名被拖小了').toBe(one)
  })

  it('常驻大标题明显大于正文字幕', () => {
    const fs = fsOf(titled('《被讨厌的勇气》\n岸见一郎、古贺史健'))
    expect(fs[0] / base.style.captionSizePx, `书名 ${fs[0]}px vs 正文 ${base.style.captionSizePx}px`)
      .toBeGreaterThan(1.3)
  })

  it('作者行明显小于书名', () => {
    const fs = fsOf(titled('《被讨厌的勇气》\n岸见一郎、古贺史健'))
    expect(fs[1]).toBeLessThan(fs[0] * 0.7)
  })

  it('超长书名仍按可用宽度缩排，不溢出画面', () => {
    const fs = fsOf(titled('《我们生活在巨大的差距里》'))[0]
    expect(fs * 13).toBeLessThanOrEqual(720 - 80)
  })
})

describe('subtitlesFilter', () => {
  it('路径里的冒号与反斜杠被转义（否则滤镜表达式被解析坏）', () => {
    expect(subtitlesFilter('/a/b:c/d.ass')).toBe("subtitles='/a/b\\:c/d.ass'")
  })
  it('给了 fontsdir 就带上', () => {
    expect(subtitlesFilter('/x.ass', '/fonts')).toBe("subtitles='/x.ass':fontsdir='/fonts'")
  })
})


describe('字幕渐入渐出（\\fad）', () => {
  const style = {
    fontName: 'F', captionColor: '#ffffff', captionPosY: 0.78, captionSizePx: 54,
    titleSizePx: 100, titleColor: '#ffe9c0', watermarkSizePx: 22,
  }
  it('给了渐入渐出 → 正文字幕带 \\fad，标题与水印不带', () => {
    const a = buildAss({
      width: 720, height: 960, totalMs: 6000,
      style: { ...style, captionFadeInMs: 200, captionFadeOutMs: 120 },
      captions: [{ text: '正文一句', startMs: 1000, endMs: 3000 }],
      bookTitles: [{ text: '《简爱》', startMs: 0, endMs: 6000 }],
      watermark: '@读书号',
    })
    const cap = a.split('\n').find((l) => l.includes('正文一句'))!
    expect(cap).toContain('{\\fad(200,120)}')
    const title = a.split('\n').find((l) => l.includes('《简爱》') && l.startsWith('Dialogue: 0'))!
    expect(title, '常驻标题不该淡入淡出（会显得画面在闪）').not.toContain('\\fad')
    const wm = a.split('\n').find((l) => l.includes('@读书号'))!
    expect(wm).not.toContain('\\fad')
  })
  // 零回归红线：不传时一个 \fad 都不出现，与加这个功能之前逐字节一致
  it('缺省（不传）→ 整份 ASS 无 \\fad', () => {
    const a = buildAss({
      width: 720, height: 960, totalMs: 6000, style,
      captions: [{ text: '正文一句', startMs: 1000, endMs: 3000 }],
    })
    expect(a).not.toContain('\\fad')
  })
})

describe('双语字幕', () => {
  const base = {
    fontName: 'Noto Sans SC', captionColor: '#ffffff', captionPosY: 0.78,
    captionSizePx: 50, titleSizePx: 60, titleColor: '#ffe9c0', watermarkSizePx: 22,
  }
  const cue = { text: '这是一句中文', en: 'This is Chinese', startMs: 0, endMs: 2000 }
  const opts = (style: Record<string, unknown>) =>
    ({ width: 720, height: 1280, captions: [cue], totalMs: 2000, style: { ...base, ...style } })

  it('默认（不开双语）逐字节等于没有 en 字段时的输出', () => {
    const withEn = buildAss(opts({}) as never)
    const withoutEn = buildAss(opts({}) as never)
    expect(withEn).toBe(withoutEn)
    expect(withEn).not.toContain('This is Chinese')
  })

  it('开启后英文行是独立的 Dialogue 事件，\\an8+\\pos 定位、内联覆盖字号/颜色', () => {
    const ass = buildAss(opts({ bilingual: true, enScale: 0.6, enColor: '#dddddd', enGapPx: 0 }) as never)
    // 50 * 0.6 = 30；cx = 720/2 = 360；enY = round(1280*0.78) + 0 = 998
    expect(ass).toContain('{\\an8\\pos(360,998)\\fs30\\c&HDDDDDD&}This is Chinese')
  })

  it('enGapPx 决定英文行顶边离中文基线多远（不再是靠 LINE_H 折算的行间距）', () => {
    const ass = buildAss(opts({ bilingual: true, enScale: 0.6, enGapPx: 8 }) as never)
    // enY = round(1280*0.78) + 8 = 1006
    expect(ass).toContain('{\\an8\\pos(360,1006)\\fs30\\c&HDDDDDD&}This is Chinese')
  })

  it('enFontName 给了就内联换字体', () => {
    const ass = buildAss(opts({ bilingual: true, enFontName: 'Space Grotesk' }) as never)
    expect(ass).toContain('\\fnSpace Grotesk}')
  })

  it('英文为空的拍不产出英文事件', () => {
    const ass = buildAss({
      width: 720, height: 1280, totalMs: 2000,
      captions: [{ text: '只有中文', startMs: 0, endMs: 1000 }],
      style: { ...base, bilingual: true },
    } as never)
    expect(ass).toContain('只有中文')
    expect(ass).not.toContain('\\an8')
  })

  it('★ 开/关双语时 Style: cap 那一行逐字节相同——中文行的位置与双语开关彻底解耦', () => {
    const off = buildAss(opts({}) as never)
    const on = buildAss(opts({ bilingual: true, enScale: 0.6, enGapPx: 8 }) as never)
    const capStyleLine = (ass: string) => ass.split('\n').find((l) => l.startsWith('Style: cap,'))
    expect(capStyleLine(on)).toBe(capStyleLine(off))
  })
})

describe('分层字体', () => {
  const base = {
    fontName: 'Noto Sans SC', captionColor: '#ffffff', captionPosY: 0.78,
    captionSizePx: 50, titleSizePx: 60, titleColor: '#ffe9c0', watermarkSizePx: 22,
    openTitleSizePx: 40, flashTitleSizePx: 58,
  }
  const build = (style: Record<string, unknown>) =>
    buildAss({ width: 720, height: 1280, captions: [], totalMs: 1000, style: { ...base, ...style } } as never)

  it('不给 titleFontName 时所有 Style 行都用 fontName（老调用零回归）', () => {
    const ass = build({})
    for (const name of ['cap', 'title', 'ot', 'wm', 'ft', 'fa']) {
      expect(ass).toContain(`Style: ${name},Noto Sans SC,`)
    }
  })

  it('给了 titleFontName 时 title/ot/ft/fa 换字体，cap/wm 不变', () => {
    const ass = build({ titleFontName: '思源宋体' })
    expect(ass).toContain('Style: cap,Noto Sans SC,')
    expect(ass).toContain('Style: wm,Noto Sans SC,')
    expect(ass).toContain('Style: title,思源宋体,')
    expect(ass).toContain('Style: ot,思源宋体,')
    expect(ass).toContain('Style: ft,思源宋体,')
    expect(ass).toContain('Style: fa,思源宋体,')
  })
})

// ★ 复盘记录：这里曾经想把 title/ot/ft/fa 的 Bold 位也改成由字重驱动、缺省 0，
// 理由是「写死 1 今天是空操作，字体池加了 Bold 文件后才会失控」。
// 真渲染实测推翻了这个前提：libass 0.17.5 上即使只有 Regular 一个文件，
// Bold=1 仍会触发 FreeType 合成假粗体，隔离测量墨迹差 25.4%（详见 ass.ts 里
// TITLE_BOLD_BORD 上方的注释与任务报告）。也就是说写死的 1 早就是存量成片
// 像素的一部分，改成 0 反而会让所有存量框架的标题无声变薄——所以 title/ot/ft/fa
// 的 Bold 位**保留写死 1**，不接受任何参数。
// cap/wm 保留 captionFontBold：场景不同——运营选的是**正文**字体，若正文字体
// 真收录了粗体字面而 Bold 位仍写死 0，libass 会静默选回 Regular，表现成
// 「选了没反应」，这类静默失效必须留一个开关能让它生效。
describe('正文的 Bold 位由 captionFontBold 驱动，标题类保持写死 1', () => {
  const base = {
    fontName: 'Noto Sans SC', captionColor: '#ffffff', captionPosY: 0.78,
    captionSizePx: 50, titleSizePx: 60, titleColor: '#ffe9c0', watermarkSizePx: 22,
    openTitleSizePx: 40, flashTitleSizePx: 58,
  }
  const build = (style: Record<string, unknown>) =>
    buildAss({ width: 720, height: 1280, captions: [], totalMs: 1000, style: { ...base, ...style } } as never)
  // Style 行里 Bold 紧跟在 BackColour 之后：找到 `Style: name,...,Bold,Italic,...`
  const boldOf = (ass: string, name: string) => {
    const line = ass.split('\n').find((l) => l.startsWith(`Style: ${name},`))!
    return line.split(',')[7] // Name,Fontname,Fontsize,Primary,Secondary,Outline,Back,Bold
  }

  it('缺省不给 captionFontBold 时，cap/wm 是 0，title/ot/ft/fa 保持写死的 1', () => {
    const ass = build({})
    expect(boldOf(ass, 'cap')).toBe('0')
    expect(boldOf(ass, 'wm')).toBe('0')
    for (const name of ['title', 'ot', 'ft', 'fa']) {
      expect(boldOf(ass, name), `${name} 的 Bold 位`).toBe('1')
    }
  })

  it('captionFontBold=true 只让 cap/wm 变 1，标题类的写死值不受影响', () => {
    const ass = build({ captionFontBold: true })
    expect(boldOf(ass, 'cap')).toBe('1')
    expect(boldOf(ass, 'wm')).toBe('1')
    for (const name of ['title', 'ot', 'ft', 'fa']) {
      expect(boldOf(ass, name), `${name} 的 Bold 位`).toBe('1')
    }
  })
})
