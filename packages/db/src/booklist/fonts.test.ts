import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FONTS, DEFAULT_FONT_ID, findBuiltinFont } from './fonts'
import { readFontMeta } from './fontFamily'

// 注册表到磁盘字体目录的相对路径：packages/db/src/booklist -> worker/templates/booklist/fonts
const FONTS_DIR = join(__dirname, '../../../../worker/templates/booklist/fonts')

describe('字体注册表', () => {
  it('默认字体在表里，且族名是 Noto Sans SC', () => {
    const d = findBuiltinFont(DEFAULT_FONT_ID)
    expect(d).toBeDefined()
    expect(d!.family).toBe('Noto Sans SC')
    expect(d!.file).toBe('NotoSansSC-Regular.otf')
  })

  it('id 唯一', () => {
    const ids = BUILTIN_FONTS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // 族名本身不再要求唯一：同一字体族的 Regular 与 Bold 是两个文件，
  // 但 family（name 表的 name ID 1）就是相同的——这是字体格式的设计，不是撞名。
  // ASS 靠 Fontname + Bold 位共同定位字面，所以真正要唯一的是 (family, weight) 组合：
  // 两条同 family 同 weight 的记录会让 libass 的 fontselect 分不清该选哪个文件。
  it('(family, weight) 组合唯一', () => {
    // 用空格做分隔符：family 与 weight 直接相连会有歧义边界情况
    // （比如构造出 "Foo7" 与 "Foo 7" 分不清的情况）。不用不可见字符做分隔——
    // 不可见字符会让 git 把整个文件当成二进制处理（diff 永远看不到改动），
    // 而且一旦被编辑/复制丢失，key 大概率仍然唯一，测试会静默退化成不测。
    const keys = BUILTIN_FONTS.map((f) => `${f.family} ${f.weight}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('认不出的 id 返回 undefined，不抛错', () => {
    expect(findBuiltinFont('nope')).toBeUndefined()
    expect(findBuiltinFont(undefined)).toBeUndefined()
  })

  // ★ 族名填错的后果是成片静默回退默认字体——渲染日志毫无异常，看起来「字体没换」。
  // 字重填错的后果同样静默：noto-sc 与 noto-sc-bold 族名相同、只靠 weight 区分，
  // 两条记录的 weight 写反了，libass 会挑错字面，界面上却看不出任何异常。
  //
  // 用 readFontMeta（packages/db/src/booklist/fontFamily.ts）而不是直接调 fontkit：
  // 后者 openSync 的返回类型是 Font | FontCollection，.ttc 字体集合没有 familyName，
  // 直接取会被 TS 拒绝（也是真实的运行时坑）；readFontMeta 已经处理了这个窄化
  // （集合文件直接拒收抛错），这里复用它，不重复实现一遍更差的版本。
  describe('注册表与磁盘一致', () => {
    for (const entry of BUILTIN_FONTS) {
      it(`${entry.id}: 文件存在，family 与 weight 都与磁盘字体解析结果逐字/逐值相同`, () => {
        const filePath = join(FONTS_DIR, entry.file)
        expect(existsSync(filePath)).toBe(true)
        const meta = readFontMeta(filePath)
        expect(meta.family).toBe(entry.family)
        expect(meta.weight).toBe(entry.weight)
      })
    }
  })
})
