import { describe, it, expect } from 'vitest'
import { splitScriptToSegments } from './splitScript'

describe('splitScriptToSegments', () => {
  it('按句号/问号/感叹号切分镜', () => {
    expect(splitScriptToSegments('第一句。第二句！第三句？')).toEqual(['第一句', '第二句', '第三句'])
  })
  it('按换行切分镜', () => {
    expect(splitScriptToSegments('第一行\n第二行\n\n第三行')).toEqual(['第一行', '第二行', '第三行'])
  })
  it('分号/中英标点混用', () => {
    expect(splitScriptToSegments('a；b;c。d?')).toEqual(['a', 'b', 'c', 'd'])
  })
  it('去首尾空白、丢空段', () => {
    expect(splitScriptToSegments('  句一 。  \n \n 句二。')).toEqual(['句一', '句二'])
  })
  it('句内逗号不切（留给 captionBeats）', () => {
    expect(splitScriptToSegments('前半，后半。下一句。')).toEqual(['前半，后半', '下一句'])
  })
  it('空/纯标点 → []', () => {
    expect(splitScriptToSegments('')).toEqual([])
    expect(splitScriptToSegments('。！？\n')).toEqual([])
    expect(splitScriptToSegments('   ')).toEqual([])
  })
})
