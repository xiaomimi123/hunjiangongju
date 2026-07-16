import { describe, it, expect } from 'vitest'
import { renderIndexHtml, type BodyData } from './indexHtml'

const data: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '《活着》', subtitle: '余华 / 著', watermark: '@读书号' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }],
  segments: [
    { seqNo: 1, startMs: 0, endMs: 2000, subtitle: '第一句 <字幕>', imageIndex: 0 },
    { seqNo: 2, startMs: 2000, endMs: 4500, subtitle: '第二句', imageIndex: 1 },
  ],
}

describe('renderIndexHtml', () => {
  const html = renderIndexHtml(data)

  it('声明合成帧与画布尺寸', () => {
    expect(html).toContain('data-composition-id="main"')
    expect(html).toContain('data-start="0"')
    expect(html).toContain('data-width="720"')
    expect(html).toContain('data-height="960"')
    // 总时长 = 最后一段 endMs/1000
    expect(html).toContain('data-duration="4.5"')
  })

  it('注册 paused GSAP timeline 于 window.__timelines["main"]', () => {
    expect(html).toContain('gsap.timeline({ paused: true })')
    expect(html).toContain('window.__timelines["main"] = tl;')
    // 本地化 GSAP：离线/CN 主机也能加载，避免运行时依赖外网 CDN。
    expect(html).toContain('<script src="gsap.min.js"></script>')
    expect(html).not.toContain('cdn.jsdelivr.net')
  })

  it('每段生成场景/字幕/缓推近/crossfade/字幕reveal', () => {
    // 两段场景 + 两段字幕
    expect(html).toContain('class="scene s1"')
    expect(html).toContain('class="scene s2"')
    expect(html).toContain('class="cap cap1"')
    expect(html).toContain('class="cap cap2"')
    // 缓推近
    expect(html).toContain("tl.fromTo('.s1 .photo', { scale: 1.035 }")
    // crossfade：第二段淡入 + 第一段淡出
    expect(html).toContain("tl.fromTo('.s2', { opacity: 0 }, { opacity: 1, duration: 0.72")
    expect(html).toContain("tl.to('.s1', { opacity: 0, duration: 0.72")
    // 字幕 reveal + 收起（位置用 startMs/1000、endMs/1000）
    expect(html).toContain("tl.fromTo('.cap2', { opacity: 0, y: 18 }")
    expect(html).toContain("tl.set('.cap2', { opacity: 0 }, 4.5)")
  })

  it('常驻标题卡与水印，含 data-layout-ignore', () => {
    expect(html).toContain('class="title-card" data-layout-ignore')
    expect(html).toContain('《活着》')
    expect(html).toContain('余华 / 著')
    expect(html).toContain('class="watermark" data-layout-ignore')
    expect(html).toContain('@读书号')
  })

  it('转义字幕中的 HTML 特殊字符', () => {
    expect(html).toContain('第一句 &lt;字幕&gt;')
    expect(html).not.toContain('第一句 <字幕>')
  })

  it('图片作为 .photo 背景', () => {
    expect(html).toContain("background-image:url('media/01.png')")
    expect(html).toContain("background-image:url('media/02.png')")
  })
})
