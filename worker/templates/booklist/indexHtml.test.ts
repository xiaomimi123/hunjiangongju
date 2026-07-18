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

  it('无 bookTitle/subtitleEn 字段时不渲染书名头/双语字幕（向后兼容 M1）', () => {
    expect(html).not.toContain('class="book-header')
    expect(html).not.toContain('class="cap-en"')
    // M1 行为保留：开场标题卡仍然渲染
    expect(html).toContain('class="title-card" data-layout-ignore')
  })

  it('向后兼容：无新增剪辑特效字段时仍能正常渲染，不抛出', () => {
    // data 未携带任何特效相关的新字段（本模板特效为无条件叠加，不依赖新输入字段）
    expect(() => renderIndexHtml(data)).not.toThrow()
    expect(html).toContain('data-composition-id="main"')
  })

  it('首场景玻璃碎片开场：4×5=20 片碎片覆盖整张图，t=0 起 stagger 归位', () => {
    expect(html).toContain('class="shatter s1shatter" data-layout-ignore')
    // 20 片碎片
    const shardCount = (html.match(/class="shard"/g) ?? []).length
    expect(shardCount).toBeGreaterThanOrEqual(20)
    // 碎片背景取自场景 1 的图
    expect(html).toContain("background-image:url('media/01.png');background-size:720px 960px")
    // 打散初始态烘焙进内联 transform（避免 function-based 值在 HyperFrames 下失效）；不依赖 Math.random
    expect(html).toContain('transform:translate(')
    expect(html).not.toContain('Math.random')
    // t=0 起用字面量 to 归位
    expect(html).toContain("tl.to('.s1shatter .shard'")
    expect(html).toContain("stagger: { amount: 0.45, from: 'center' } }, 0);")
    // 拼合前隐藏真实 .photo，归位后再淡入接手、碎片层淡出
    expect(html).toContain("tl.set('.s1 .photo', { opacity: 0 }, 0);")
    expect(html).toContain("tl.to('.s1shatter', { opacity: 0, duration: 0.25, ease: 'sine.inOut' }, 0.88);")
  })

  it('场景间碎片/马赛克转场：叠在既有 0.72s crossfade 窗口内，不占用额外时长', () => {
    // 两段场景只有一个边界（s1→s2）
    expect(html).toContain('class="tshatter ts2" data-layout-ignore')
    expect(html).toContain("tl.set('.ts2', { opacity: 1 }, 2);")
    expect(html).toContain("tl.to('.ts2 .shard'")
    expect(html).toContain("stagger: { amount: 0.26, from: 'edges' } }, 2);")
    expect(html).toContain("tl.set('.ts2', { opacity: 0 }, 2.72);")
  })

  it('末段结尾定格强调：暗角渐入 + 更强缓推近，不改变段时长/总时长', () => {
    expect(html).toContain('class="vignette" data-layout-ignore')
    // 末段（s2，2s→4.5s）暗角渐入，时长=段自身长度(2.5s)，起点=段 startSec
    expect(html).toContain(
      "tl.fromTo('.vignette', { opacity: 0 }, { opacity: 0.55, duration: 2.5, ease: 'sine.in' }, 2);",
    )
    // 末段缓推近目标幅度加大（1.16），首段维持原幅度（1.105）
    expect(html).toContain("tl.fromTo('.s2 .photo', { scale: 1.035 }, { scale: 1.16")
    expect(html).toContain("tl.fromTo('.s1 .photo', { scale: 1.035 }, { scale: 1.105")
    // 总时长未变（仍由最后一段 endMs 决定）
    expect(html).toContain('data-duration="4.5"')
  })
})

// 书单模式：段带 bookTitle/bookAuthor/subtitleEn
const booksData: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '', subtitle: '', watermark: '@听页/书评分享' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }, { src: 'media/03.png' }],
  segments: [
    {
      seqNo: 1,
      startMs: 0,
      endMs: 2000,
      subtitle: '所以在脑海里刻薄的自责',
      subtitleEn: 'So I blame myself bitterly in my head',
      imageIndex: 0,
      bookTitle: '活下去的理由',
      bookAuthor: '马特·海格',
    },
    {
      seqNo: 2,
      startMs: 2000,
      endMs: 4000,
      subtitle: '第二句 <特殊>',
      subtitleEn: 'The second line & more',
      imageIndex: 1,
      bookTitle: '活下去的理由',
      bookAuthor: '马特·海格',
    },
    {
      seqNo: 3,
      startMs: 4000,
      endMs: 6000,
      subtitle: '第三句',
      subtitleEn: 'The third line',
      imageIndex: 2,
      bookTitle: '当下的力量',
      bookAuthor: '埃克哈特·托利',
    },
  ],
}

describe('renderIndexHtml — 书单模式（bookTitle/subtitleEn）', () => {
  const html = renderIndexHtml(booksData)

  it('渲染常驻书名头（书名+作者）', () => {
    expect(html).toContain('class="book-header')
    expect(html).toContain('活下去的理由')
    expect(html).toContain('马特·海格')
    expect(html).toContain('当下的力量')
    expect(html).toContain('埃克哈特·托利')
  })

  it('连续同书的段落合并为同一个书名头元素（不重复渲染/不闪烁）', () => {
    // 段1、2 同书 → 只应出现一次「活下去的理由」书名头容器
    const matches = html.match(/class="book-header bh1"/g) ?? []
    expect(matches.length).toBe(1)
    // 第二个书名头对应第 3 段（书变了）
    expect(html).toContain('class="book-header bh2"')
  })

  it('渲染中英双语字幕（中文 + 英文）', () => {
    expect(html).toContain('class="cap-zh"')
    expect(html).toContain('class="cap-en"')
    expect(html).toContain('So I blame myself bitterly in my head')
    expect(html).toContain('The third line')
  })

  it('转义书名头与英文字幕中的特殊字符', () => {
    expect(html).toContain('第二句 &lt;特殊&gt;')
    expect(html).toContain('The second line &amp; more')
  })

  it('书单模式下不再渲染开场标题卡（由常驻书名头取代）', () => {
    expect(html).not.toContain('class="title-card"')
  })

  it('保留水印', () => {
    expect(html).toContain('class="watermark" data-layout-ignore')
    expect(html).toContain('@听页/书评分享')
  })

  it('书单模式下剪辑特效仍正常叠加：开场碎片 + 两个转场边界 + 末段（s3）定格强调', () => {
    expect(() => renderIndexHtml(booksData)).not.toThrow()
    expect(html).toContain('class="shatter s1shatter" data-layout-ignore')
    // 3 段场景 → 2 个转场边界（s1→s2、s2→s3）
    expect(html).toContain('class="tshatter ts2" data-layout-ignore')
    expect(html).toContain('class="tshatter ts3" data-layout-ignore')
    // 末段是 s3，定格强调应作用于 s3 而非 s1/s2
    expect(html).toContain("tl.fromTo('.s3 .photo', { scale: 1.035 }, { scale: 1.16")
    expect(html).toContain("tl.fromTo('.s2 .photo', { scale: 1.035 }, { scale: 1.105")
    expect(html).toContain('class="vignette" data-layout-ignore')
  })
})
