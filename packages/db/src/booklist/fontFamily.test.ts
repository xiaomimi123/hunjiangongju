import { describe, it, expect } from 'vitest'
import path from 'path'
import { readFontMeta } from './fontFamily'

const FONTS_DIR = path.resolve(__dirname, '../../../../worker/templates/booklist/fonts')
const REGULAR = path.join(FONTS_DIR, 'NotoSansSC-Regular.otf')
const BOLD = path.join(FONTS_DIR, 'NotoSansSC-Bold.otf')
const SERIF = path.join(FONTS_DIR, 'NotoSerifSC-Regular.otf')

describe('readFontMeta', () => {
  it('读出 Regular 字体的族名与字重', () => {
    expect(readFontMeta(REGULAR)).toEqual({ family: 'Noto Sans SC', weight: 400 })
  })

  // 最重要的一条：锁住「族名相同、靠字重区分」这个本项目的核心事实——
  // Regular 与 Bold 是同一个 family，ass.ts 靠 weight 推出的 Bold 位来选字面。
  it('读出 Bold 字体的族名与字重 —— 族名与 Regular 相同，靠字重区分', () => {
    expect(readFontMeta(BOLD)).toEqual({ family: 'Noto Sans SC', weight: 700 })
  })

  it('读出另一款字体的族名与字重', () => {
    expect(readFontMeta(SERIF)).toEqual({ family: 'Noto Serif SC', weight: 400 })
  })

  it('不是字体文件时抛错 —— 必须拒收，族名错了会静默回退默认字体、毫无报错', () => {
    expect(() => readFontMeta(__filename)).toThrow()
  })

  it('文件不存在时抛错', () => {
    expect(() => readFontMeta('/nope/nope.ttf')).toThrow()
  })
})
