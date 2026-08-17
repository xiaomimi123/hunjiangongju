import { describe, it, expect } from 'vitest'
import { parseBookMarkedLines } from './generateScript'

describe('parseBookMarkedLines', () => {
  it('全部行合法 → 解析出序号与文案', () => {
    expect(parseBookMarkedLines(['1|《活着》告诉你', '2|他靠想象活过一天'], 3)).toEqual([
      { bookIdx: 1, text: '《活着》告诉你' },
      { bookIdx: 2, text: '他靠想象活过一天' },
    ])
  })

  it('序号 0 表示开场白', () => {
    expect(parseBookMarkedLines(['0|今天分享的是五本书', '1|正文'], 2)).toEqual([
      { bookIdx: 0, text: '今天分享的是五本书' },
      { bookIdx: 1, text: '正文' },
    ])
  })

  it('全角竖线同样接受', () => {
    expect(parseBookMarkedLines(['1｜全角分隔'], 1)).toEqual([{ bookIdx: 1, text: '全角分隔' }])
  })

  it('序号与文案两侧空白被吃掉', () => {
    expect(parseBookMarkedLines(['  2 |  有空白  '], 2)).toEqual([{ bookIdx: 2, text: '有空白' }])
  })

  it('文案本身含竖线 → 只按首个分隔符切分', () => {
    expect(parseBookMarkedLines(['1|前|后'], 1)).toEqual([{ bookIdx: 1, text: '前|后' }])
  })

  it('空行被忽略，不影响解析', () => {
    expect(parseBookMarkedLines(['1|甲', '', '  ', '2|乙'], 2)).toEqual([
      { bookIdx: 1, text: '甲' },
      { bookIdx: 2, text: '乙' },
    ])
  })

  it('任一行缺标记 → 整体返回 null（全有或全无）', () => {
    expect(parseBookMarkedLines(['1|甲', '没有标记的一行', '2|乙'], 2)).toBeNull()
  })

  it('序号越界（大于书数）→ null', () => {
    expect(parseBookMarkedLines(['1|甲', '7|乙'], 5)).toBeNull()
  })

  it('分隔符后没有文案 → null', () => {
    expect(parseBookMarkedLines(['1|'], 1)).toBeNull()
  })

  it('全空输入 → null', () => {
    expect(parseBookMarkedLines(['', '   '], 3)).toBeNull()
  })
})
