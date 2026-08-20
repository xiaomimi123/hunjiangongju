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
    expect(a).toContain('Dialogue: 0,0:00:03.98,0:00:20.00,title,,0,0,0,,《简爱》')
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

describe('subtitlesFilter', () => {
  it('路径里的冒号与反斜杠被转义（否则滤镜表达式被解析坏）', () => {
    expect(subtitlesFilter('/a/b:c/d.ass')).toBe("subtitles='/a/b\\:c/d.ass'")
  })
  it('给了 fontsdir 就带上', () => {
    expect(subtitlesFilter('/x.ass', '/fonts')).toBe("subtitles='/x.ass':fontsdir='/fonts'")
  })
})
