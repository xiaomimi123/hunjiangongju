import { describe, it, expect } from 'vitest'
import { contentDispositionAttachment } from './contentDisposition'
describe('contentDispositionAttachment', () => {
  it('纯 ASCII 文件名', () => {
    expect(contentDispositionAttachment('final.mp4')).toContain('attachment; filename="final.mp4"')
  })
  it('中文文件名用 filename* UTF-8 编码', () => {
    const s = contentDispositionAttachment('活着.mp4')
    expect(s).toContain('attachment;')
    expect(s).toContain("filename*=UTF-8''")
    expect(s).toContain(encodeURIComponent('活着.mp4'))
  })
  it('去掉换行/引号等危险字符', () => {
    expect(contentDispositionAttachment('a"b\n.mp4')).not.toContain('\n')
    expect(contentDispositionAttachment('a"b\n.mp4')).not.toContain('"b')
  })
})
