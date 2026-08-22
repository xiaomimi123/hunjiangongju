import { describe, it, expect } from 'vitest'
import { resolveBooks, DEFAULT_IMAGE_STYLE, coverCustomRelPath } from './generateImage'

describe('DEFAULT_IMAGE_STYLE', () => {
  // ★ 兜底画风**不得带流派签名**。
  //
  // 原值是「梵高后印象派风格,旋转笔触,厚重颜料肌理,…」，而后台那个输入框连
  // placeholder 都没有：运营看到空白框、什么都没填，出来的图却全是梵高，
  // 从界面上完全看不出这个默认值存在（线上实测反馈）。
  it('不含任何画派/画家名', () => {
    expect(DEFAULT_IMAGE_STYLE).toBeTruthy()
    for (const painter of ['梵高', '莫奈', '达芬奇', '毕加索', '浮世绘', '后印象派', '印象派']) {
      expect(DEFAULT_IMAGE_STYLE, `兜底画风又混进了流派签名: ${DEFAULT_IMAGE_STYLE}`).not.toContain(painter)
    }
  })

  // 也不能干脆留空：四张图各发一次生图请求，没有统一约束时模型会给出
  // 照片/插画/3D 混搭的四张，成片观感是坏的。兜底只约束质感与光线。
  it('仍给出统一的质感/光线方向（不是空串）', () => {
    expect(Array.from(DEFAULT_IMAGE_STYLE).length).toBeGreaterThan(8)
  })

  // 「无人物」已去掉：negative_prompt 不再硬禁人物（见 artScenes.ts:IMAGE_NEGATIVE_PROMPT），
  // 而开场那张卡通头像走的正是这个兜底值——留着它头像根本出不来。
  it('不禁人物（开场头像槽位靠它）', () => {
    expect(DEFAULT_IMAGE_STYLE).not.toContain('无人物')
  })
})

describe('resolveBooks', () => {
  it('优先 variables.books', () => {
    expect(resolveBooks({ books: [{ title: '活着', author: '余华' }] }, { books: [{ title: 'X' }] }))
      .toEqual([{ title: 'X' }])
  })
  it('overlayTemplate 无 → 回退 variables.books', () => {
    expect(resolveBooks({}, { books: [{ title: 'A' }] })).toEqual([{ title: 'A' }])
  })
  it('过滤无 title 的脏项；都没有 → []', () => {
    expect(resolveBooks({ books: [{ title: '' }, { author: 'x' }, { title: 'B' }] }, {})).toEqual([{ title: 'B' }])
    expect(resolveBooks({}, {})).toEqual([])
  })
})

describe('resolveBooks —— variables.books 优先', () => {
  it('两者都有时用 variables.books（per-generation 比框架默认值更具体）', () => {
    const out = resolveBooks(
      { books: [{ title: '框架原书', author: '原作者' }] },
      { books: [{ title: '本次选书甲' }, { title: '本次主题书', author: '某作者' }] },
    )
    expect(out.map((b) => b.title)).toEqual(['本次选书甲', '本次主题书'])
  })

  it('variables.books 为空 → 回退框架书目', () => {
    expect(resolveBooks({ books: [{ title: '框架原书' }] }, { books: [] }).map((b) => b.title)).toEqual(['框架原书'])
    expect(resolveBooks({ books: [{ title: '框架原书' }] }, {}).map((b) => b.title)).toEqual(['框架原书'])
  })

  it('两者皆空 → 空数组', () => {
    expect(resolveBooks({}, {})).toEqual([])
  })

  it('脏项（无 title / title 空白）被过滤，顺序不变', () => {
    const out = resolveBooks({}, { books: [{ title: '甲' }, { title: '  ' }, { author: '无题' }, { title: '乙' }] })
    expect(out.map((b) => b.title)).toEqual(['甲', '乙'])
  })
})


describe('coverCustomRelPath —— 框架专属书封的缓存路径', () => {
  // 配了专属提示词就不能吃公共书库的封面缓存（风格改了等于白改），
  // 也不能写回公共书库（污染其它框架）。按提示词哈希分目录：
  it('同提示词同书 → 同路径（缓存命中）', () => {
    expect(coverCustomRelPath('水墨山水', '活着')).toBe(coverCustomRelPath('水墨山水', '活着'))
  })
  it('提示词一改 → 目录就变（自动失效，不需要清理逻辑）', () => {
    const a = coverCustomRelPath('水墨山水', '活着')
    const b = coverCustomRelPath('赛博朋克', '活着')
    expect(a).not.toBe(b)
  })
  it('路径在 covers-custom 下、按规范化书名命名', () => {
    expect(coverCustomRelPath('x', '《活着》')).toMatch(/^covers-custom\/[0-9a-f]{12}\/活着\.png$/)
  })
})
