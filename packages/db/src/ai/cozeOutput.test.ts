import { describe, it, expect } from 'vitest'
import { parseCozeOutput } from './cozeOutput'

describe('parseCozeOutput', () => {
  it('纯文本对象 → text 项', () => {
    const items = parseCozeOutput({ output: '这是一段生成结果文本' })
    expect(items).toEqual([{ kind: 'text', text: '这是一段生成结果文本' }])
  })

  it('data 为 JSON 字符串 → 先 parse 再遍历', () => {
    const raw = JSON.stringify({ output: '解析出来的文本' })
    const items = parseCozeOutput(raw)
    expect(items).toEqual([{ kind: 'text', text: '解析出来的文本' }])
  })

  it('图片 URL → image 项', () => {
    const items = parseCozeOutput({ image_url: 'https://example.com/a/b.png' })
    expect(items).toEqual([{ kind: 'image', url: 'https://example.com/a/b.png' }])
  })

  it('视频 URL → video 项', () => {
    const items = parseCozeOutput({ video_url: 'https://example.com/a/b.mp4' })
    expect(items).toEqual([{ kind: 'video', url: 'https://example.com/a/b.mp4' }])
  })

  it('混合嵌套数组 → 分别识别 text/image/video/file', () => {
    const raw = {
      list: [
        { text: '标题文本', img: 'https://cdn.example.com/x.jpg' },
        ['https://cdn.example.com/y.mp4', 'https://cdn.example.com/doc.pdf'],
        { ignored_number: 42, ignored_bool: true, ignored_null: null },
      ],
    }
    const items = parseCozeOutput(raw)
    expect(items).toEqual([
      { kind: 'text', text: '标题文本' },
      { kind: 'image', url: 'https://cdn.example.com/x.jpg' },
      { kind: 'video', url: 'https://cdn.example.com/y.mp4' },
      { kind: 'file', url: 'https://cdn.example.com/doc.pdf' },
    ])
  })

  it('空对象 → []', () => {
    expect(parseCozeOutput({})).toEqual([])
  })

  it('数字/布尔全部忽略 → []', () => {
    expect(parseCozeOutput({ a: 1, b: true, c: null })).toEqual([])
  })

  it('URL 带 query 仍按 pathname 后缀识别为 image', () => {
    const items = parseCozeOutput({ url: 'https://cdn.example.com/pic.png?sign=xxx&exp=123' })
    expect(items).toEqual([{ kind: 'image', url: 'https://cdn.example.com/pic.png?sign=xxx&exp=123' }])
  })

  it('URL 带 query 仍按 pathname 后缀识别为 video', () => {
    const items = parseCozeOutput({ url: 'https://cdn.example.com/clip.mp4?token=abc' })
    expect(items).toEqual([{ kind: 'video', url: 'https://cdn.example.com/clip.mp4?token=abc' }])
  })

  it('同一 URL 在嵌套结构里出现多次 → 去重只出一次', () => {
    const raw = {
      a: 'https://cdn.example.com/dup.png',
      nested: { b: 'https://cdn.example.com/dup.png', c: ['https://cdn.example.com/dup.png'] },
    }
    const items = parseCozeOutput(raw)
    expect(items).toEqual([{ kind: 'image', url: 'https://cdn.example.com/dup.png' }])
  })

  it('text 项去重且保序', () => {
    const raw = { a: '重复文本', list: ['另一段文本', '重复文本', '第三段文本'] }
    const items = parseCozeOutput(raw)
    expect(items).toEqual([
      { kind: 'text', text: '重复文本' },
      { kind: 'text', text: '另一段文本' },
      { kind: 'text', text: '第三段文本' },
    ])
  })

  it('单条 text 超长（>5000 字符）截断加省略号', () => {
    const longText = 'a'.repeat(5001)
    const items = parseCozeOutput({ output: longText })
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.kind).toBe('text')
    if (item.kind === 'text') {
      expect(item.text.length).toBe(5001) // 5000 字符 + 省略号
      expect(item.text.endsWith('…')).toBe(true)
      expect(item.text.startsWith('a'.repeat(5000))).toBe(true)
    }
  })

  it('内层 JSON 字符串下钻解析：拿到真正的业务值而不是原始 JSON 文本', () => {
    const inner = JSON.stringify({ output: '内层文本' })
    const raw = JSON.stringify({ payload: inner })
    const items = parseCozeOutput(raw)
    expect(items).toEqual([{ kind: 'text', text: '内层文本' }])
  })

  it('线上实测形状：output 是 draft_url JSON 字符串 + 空 {} 噪音 → 一条 link，噪音消失', () => {
    // 2026-09-06 书单工作流真实输出：两个字段各是一层 JSON 字符串
    const raw = JSON.stringify({
      output: '{"draft_url":"https://agent.ai-tools.cn/jyxzs?draft_url=https%3A%2F%2Fagent-cos.ai-tools.cn%2Fdraft%2Fx.json"}',
      other: '{}',
    })
    const items = parseCozeOutput(raw)
    expect(items).toEqual([
      { kind: 'link', url: 'https://agent.ai-tools.cn/jyxzs?draft_url=https%3A%2F%2Fagent-cos.ai-tools.cn%2Fdraft%2Fx.json' },
    ])
  })

  it('嵌套 JSON 字符串超过深度上限不再下钻（解析炸弹防御仍有效）', () => {
    // 每层都是「对象再序列化成字符串」的套娃，下钻会逐层消耗深度，超过 MAX_DEPTH=6 应被丢弃
    let s = JSON.stringify({ u: 'https://cdn.example.com/deep.png' })
    for (let i = 0; i < 7; i++) s = JSON.stringify({ nested: s })
    expect(parseCozeOutput(s)).toEqual([])
  })

  it('无扩展名的网页 URL → link 项（worker 不该去下载网页）', () => {
    const items = parseCozeOutput({ url: 'https://example.com/share/abc123' })
    expect(items).toEqual([{ kind: 'link', url: 'https://example.com/share/abc123' }])
  })

  it('递归深度超过上限时不再下钻，深层数据不出现在结果里', () => {
    // 构造 8 层深的嵌套对象，超过 MAX_DEPTH=6 的部分应被丢弃
    let deep: unknown = 'https://cdn.example.com/toodeep.png'
    for (let i = 0; i < 8; i++) deep = { nested: deep }
    const items = parseCozeOutput(deep as Record<string, unknown>)
    expect(items).toEqual([])
  })

  it('trim 后长度 < 2 的字符串不当作文本', () => {
    const items = parseCozeOutput({ a: ' ', b: 'x', c: '' })
    expect(items).toEqual([])
  })

  it('非 JSON 字符串 raw（既非 URL 也非空）→ 按普通文本处理', () => {
    const items = parseCozeOutput('这不是合法 JSON 也不是 URL')
    expect(items).toEqual([{ kind: 'text', text: '这不是合法 JSON 也不是 URL' }])
  })

  it('识别不出任何项时返回 []', () => {
    expect(parseCozeOutput(null)).toEqual([])
    expect(parseCozeOutput(undefined)).toEqual([])
    expect(parseCozeOutput([1, 2, true])).toEqual([])
  })

  it('非法 JSON 字符串（扣子转义 bug）：正则捞出 URL，机器噪音不当文本返回', () => {
    const bad = '{"a":"{\\"x\\":1}",oops "Output":"https://v.coze.cn/final.mp4?sign=x and https://img.coze.cn/cover.png"}'
    expect(() => JSON.parse(bad)).toThrow()
    const items = parseCozeOutput(bad)
    expect(items).toEqual([
      { kind: 'video', url: 'https://v.coze.cn/final.mp4?sign=x' },
      { kind: 'image', url: 'https://img.coze.cn/cover.png' },
    ])
  })

  it('非法 JSON 字符串正则兜底：URL 尾部粘连的标点被裁掉', () => {
    // 正则贪婪匹配 URL 时容易把紧跟其后的中英文标点也吞进来（这里是右括号+中文逗号，
    // 以及句尾的右方括号+句号），裁剪后 URL 才是能打开的干净地址。
    const bad = '{"a":"{\\"x\\":1}",oops "Output":"(见 https://v.coze.cn/final.mp4) 封面 https://img.coze.cn/cover.png]。"}'
    expect(() => JSON.parse(bad)).toThrow()
    const items = parseCozeOutput(bad)
    expect(items).toEqual([
      { kind: 'video', url: 'https://v.coze.cn/final.mp4' },
      { kind: 'image', url: 'https://img.coze.cn/cover.png' },
    ])
  })
})
