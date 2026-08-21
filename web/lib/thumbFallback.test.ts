import { describe, it, expect } from 'vitest'
import { fallbackOriginal } from './thumbFallback'

// ★ 线上素材库刷一屏 404：thumbUrl() 是纯字符串推导，页面拿到原图 URL 就一定会请求
// `.thumb.webp`，而缩略图是「锦上添花」的产物——剪映批量导入时 makeThumb 失败只记
// warning（不能让一张坏图拖垮整批导入），老素材更是在这个功能之前入的库。
describe('fallbackOriginal', () => {
  const has = (...files: string[]) => (p: string) => files.includes(p)

  it('缩略图缺失时找出同名原图', () => {
    expect(fallbackOriginal('assets/abc.thumb.webp', has('assets/abc.png'))).toBe('assets/abc.png')
    expect(fallbackOriginal('assets/abc.thumb.webp', has('assets/abc.jpg'))).toBe('assets/abc.jpg')
  })

  // 缩略图名里看不出原图格式，只能逐个试
  it('按扩展名依次尝试', () => {
    expect(fallbackOriginal('gen/x/3.thumb.webp', has('gen/x/3.jpeg'))).toBe('gen/x/3.jpeg')
    expect(fallbackOriginal('a/b.thumb.webp', has('a/b.webp'))).toBe('a/b.webp')
  })

  // 不是缩略图请求就别管：普通文件缺失该照常 404，不能悄悄换成别的文件
  it('非缩略图请求一律不兜底', () => {
    expect(fallbackOriginal('assets/abc.png', has('assets/abc.jpg'))).toBeNull()
    expect(fallbackOriginal('gen/x/full.mp4', has('gen/x/full.png'))).toBeNull()
  })

  it('原图也不在时返回 null（照常 404）', () => {
    expect(fallbackOriginal('assets/abc.thumb.webp', has())).toBeNull()
  })

  it('空基名不兜底', () => {
    expect(fallbackOriginal('.thumb.webp', has('.png'))).toBeNull()
  })
})
