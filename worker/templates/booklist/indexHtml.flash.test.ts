import { describe, it, expect } from 'vitest'
import { renderIndexHtml, type BodyData } from './indexHtml'
import { parseTemplateParams, DEFAULT_PARAMS } from './templateParams'

const flashData: BodyData = {
  size: { width: 720, height: 960 },
  overlay: { title: '', subtitle: '', watermark: '@读书号' },
  images: [{ src: 'media/01.png' }, { src: 'media/02.png' }],
  seed: 's1',
  template: 'flash',
  templateParams: parseTemplateParams({ mode: 'flash' }),
  flashCovers: [
    { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
    { title: '兄弟', coverSrc: 'covers/02.png' },
  ],
  fonts: [{ family: 'flash-title', url: 'fonts/title.ttf' }, { family: 'subtitle', url: 'fonts/sub.otf' }],
  segments: [
    { seqNo: 1, startMs: 0, endMs: 4000, subtitle: '今天分享的是', imageIndex: 0 },
    { seqNo: 2, startMs: 4000, endMs: 9000, subtitle: '如果你总困在过往', imageIndex: 1,
      captionBeats: [{ zh: '如果你总困在过往', startMs: 4000, endMs: 9000 }] },
  ],
}

describe('renderIndexHtml — flash 分支', () => {
  const html = renderIndexHtml(flashData)
  it('契约仍在、seek-safe、总时长=末段', () => {
    expect(html).toContain('data-composition-id="main"')
    expect(html).toContain('data-duration="9"')
    expect(html).toContain('window.__timelines["main"] = tl;')
    expect(html).not.toContain('function'); expect(html).not.toContain('=>'); expect(html).not.toContain('Math.random')
    expect(html).not.toContain('cdn.jsdelivr.net')
  })
  it('含开场标题 + 书封快闪卡 + @font-face', () => {
    expect(html).toContain('class="flash-open"')
    expect(html).toContain('今天分享的是')
    expect((html.match(/class="flashcard/g) ?? []).length).toBe(2)
    expect(html).toContain('活着')
    expect(html).toContain('@font-face')
    expect(html).toContain("url('fonts/title.ttf')")
  })
  it('正片段(seg2)仍出场景+字幕', () => {
    expect(html).toContain('如果你总困在过往')
  })
  it('确定性', () => { expect(renderIndexHtml(flashData)).toBe(renderIndexHtml(flashData)) })
})

describe('renderIndexHtml — classic 回归', () => {
  it('无 template 字段 → 走 classic，不含快闪', () => {
    const classic: BodyData = { ...flashData, template: undefined, templateParams: undefined, flashCovers: undefined }
    const html = renderIndexHtml(classic)
    expect(html).not.toContain('class="flash-open"')
    expect(html).not.toContain('class="flashcard')
    expect(html).toContain('data-composition-id="main"')
  })
})

describe('renderIndexHtml — flash 分支调色注入', () => {
  it('templateParams.grade 存在(真实新模板样本值) → 渲染 HTML 含对应 filter 声明', () => {
    const withGrade: BodyData = {
      ...flashData,
      templateParams: parseTemplateParams({
        mode: 'flash',
        grade: { filterName: '青橙', intensity: 0.503, contrast: -0.2138, sharpen: true },
      }),
    }
    const html = renderIndexHtml(withGrade)
    expect(html).toContain(
      '.scene .photo, .scene .bg-fill, .flashcard .fc-cover, .shatter .shard, .tshatter .shard { filter: contrast(0.834) saturate(1.126) sepia(0.091) hue-rotate(-5.03deg); }'
    )
  })
  it('templateParams.grade 缺省 → 渲染 HTML 不含任何调色 filter 声明', () => {
    const html = renderIndexHtml(flashData) // flashData.templateParams 无 grade 字段
    expect(html).not.toContain('filter: contrast(')
  })
})

describe('renderIndexHtml — flash 分支叠化转场窗口(接入 transition.durationMs)', () => {
  // 回归锁：transition.durationMs 等于 parseTemplateParams 自己的默认值(400ms)时，
  // 必须视为"没有真提取到"，不覆盖，窗口保持渲染器历史默认 0.72s——已有框架/未提取到转场的
  // 工程输出必须逐字节不变。这条测试是 fix round 1 漏掉、fix round 2 补上的守卫。
  it('durationMs 等于解析器默认值(400ms) → 视为未提取到，窗口仍是 0.72（不覆盖，兼容所有已有框架）', () => {
    expect(DEFAULT_PARAMS.transition.durationMs).toBe(400)
    const html = renderIndexHtml(flashData) // flashData.templateParams = parseTemplateParams({ mode: 'flash' })，未给 transition → 走默认值 400ms
    expect(html).toContain("tl.fromTo('.s2', { opacity: 0 }, { opacity: 1, duration: 0.72")
    expect(html).toContain("tl.to('.s1', { opacity: 0, duration: 0.72")
  })
  it('真提取到 467ms(新模板样本) → 叠化窗口用 0.467', () => {
    const withTrans: BodyData = {
      ...flashData,
      templateParams: parseTemplateParams({ mode: 'flash', transition: { durationMs: 467 } }),
    }
    const html = renderIndexHtml(withTrans)
    expect(html).toContain("tl.fromTo('.s2', { opacity: 0 }, { opacity: 1, duration: 0.467")
    expect(html).toContain("tl.to('.s1', { opacity: 0, duration: 0.467")
    expect(html).not.toContain("duration: 0.72, ease: 'sine.inOut' }, 4)")
  })
  it('真提取到 500ms(老模板样本) → 叠化窗口用 0.5', () => {
    const withTrans: BodyData = {
      ...flashData,
      templateParams: parseTemplateParams({ mode: 'flash', transition: { durationMs: 500 } }),
    }
    const html = renderIndexHtml(withTrans)
    expect(html).toContain("tl.fromTo('.s2', { opacity: 0 }, { opacity: 1, duration: 0.5")
    expect(html).toContain("tl.to('.s1', { opacity: 0, duration: 0.5")
    expect(html).not.toContain("duration: 0.72, ease: 'sine.inOut' }, 4)")
  })
  it('窗口超过当前段自身时长时夹住，不产出跨段重叠的 tween', () => {
    const shortSeg: BodyData = {
      ...flashData,
      templateParams: parseTemplateParams({ mode: 'flash', transition: { durationMs: 467 } }),
      segments: [
        { seqNo: 1, startMs: 0, endMs: 4000, subtitle: '今天分享的是', imageIndex: 0 },
        { seqNo: 2, startMs: 4000, endMs: 4300, subtitle: '短段', imageIndex: 1,
          captionBeats: [{ zh: '短段', startMs: 4000, endMs: 4300 }] },
      ],
    }
    const html = renderIndexHtml(shortSeg)
    expect(html).toContain('duration: 0.3') // 段长 300ms < 467ms 窗口，夹到段长
    expect(html).not.toContain('duration: 0.467')
  })
})

describe('renderIndexHtml — flash 分支 kenBurns:off 但有 motion.moves 时仍出运镜（I-1）', () => {
  // kenBurns 来自 material_animations（文字动画信号）、moves 来自 common_keyframes（关键帧信号），
  // 二者相互独立：草稿可能只有文字动画（kenBurns:'off'）却纯靠关键帧做运镜（moves 非空）。
  // 此前只看 kenBurns==='subtle' 会把这类草稿的运镜整段丢弃，正片变成静止画面。
  it('kenBurns:off + moves 非空 → 渲染 HTML 仍含 .sN .photo 的 scale/position tween', () => {
    const withMoves: BodyData = {
      ...flashData,
      templateParams: parseTemplateParams({ mode: 'flash', body: { kenBurns: 'off' }, motion: { moves: ['pan-right'] } }),
    }
    const html = renderIndexHtml(withMoves)
    expect(html).toContain("tl.fromTo('.s2 .photo'")
    expect(html).toMatch(/'\.s2 \.photo'.*scale:/)
  })
  it('kenBurns:off + moves 为空（老框架/未提取到）→ 仍维持零回归，不出运镜 tween', () => {
    const noMoves: BodyData = {
      ...flashData,
      templateParams: parseTemplateParams({ mode: 'flash', body: { kenBurns: 'off' } }),
    }
    const html = renderIndexHtml(noMoves)
    expect(html).not.toContain("tl.fromTo('.s2 .photo'")
  })
})

describe('renderIndexHtml — flash 分支叠化转场窗口下限（M-4）', () => {
  it('真提取到 durationMs=0 → 叠化窗口下限夹到 0.05，不产出 duration: 0 的硬切', () => {
    const zeroTrans: BodyData = {
      ...flashData,
      templateParams: parseTemplateParams({ mode: 'flash', transition: { durationMs: 0 } }),
    }
    const html = renderIndexHtml(zeroTrans)
    expect(html).toContain("tl.fromTo('.s2', { opacity: 0 }, { opacity: 1, duration: 0.05")
    expect(html).not.toContain('duration: 0,')
  })
})

describe('renderIndexHtml — flash 常驻书名头', () => {
  const withBook: BodyData = {
    ...flashData,
    segments: [
      { seqNo: 1, startMs: 0, endMs: 4000, subtitle: '今天分享的是', imageIndex: 0, bookTitle: '活着' },
      { seqNo: 2, startMs: 4000, endMs: 9000, subtitle: '正片一句', imageIndex: 1, bookTitle: '活着',
        captionBeats: [{ zh: '正片一句', startMs: 4000, endMs: 9000 }] },
    ],
  }
  const html = renderIndexHtml(withBook)
  it('正片段带 bookTitle → 渲染常驻《书名》头', () => {
    expect(html).toContain('class="book-header')
    expect(html).toContain('《活着》')
  })
  it('书名头在正片开始(flashEnd)后淡入,不早于快闪窗口', () => {
    // flashEnd = seg0.endMs = 4s；书名头 fromTo 起点应 >= 4
    expect(html).toMatch(/\.bh1'[^\n]*opacity: 1[^\n]*, 4\)/)
  })
})

// 阶段1：逐边界转场。实测样例的 13 个边界只有 3 个有转场（300/500/500），
// 快闪→正片那一刀是硬切；现有实现取全局众数套给所有边界，既抹平差异也把硬切当成了叠化。
describe('renderIndexHtml — 逐边界转场', () => {
  const withCycle = (extra: Record<string, unknown>): BodyData => ({
    ...flashData,
    templateParams: {
      ...flashData.templateParams!,
      transition: { type: 'dissolve' as const, durationMs: 500, ...extra },
    },
    segments: [
      { seqNo: 1, startMs: 0, endMs: 4000, subtitle: '今天分享的是', imageIndex: 0 },
      { seqNo: 2, startMs: 4000, endMs: 9000, subtitle: 'A', imageIndex: 1 },
      { seqNo: 3, startMs: 9000, endMs: 14000, subtitle: 'B', imageIndex: 1 },
      { seqNo: 4, startMs: 14000, endMs: 19000, subtitle: 'C', imageIndex: 1 },
    ],
  })

  it('enterBodyHardCut=true → 第一个正片段不生成任何转场 tween（硬切）', () => {
    const html = renderIndexHtml(withCycle({
      enterBodyHardCut: true,
      bodyCycle: [{ renderType: 'crossfade', durationMs: 300 }, { renderType: 'crossfade', durationMs: 500 }],
    }))
    // .s2 是第一个正片段：应只有运镜，没有以 4 秒为起点的叠化
    expect(html).not.toContain(`tl.fromTo('.s2', { opacity: 0 }`)
  })

  it('后续边界按 bodyCycle 循环套用各自时长，而非全片统一', () => {
    const html = renderIndexHtml(withCycle({
      enterBodyHardCut: true,
      bodyCycle: [{ renderType: 'crossfade', durationMs: 300 }, { renderType: 'crossfade', durationMs: 500 }],
    }))
    // .s3 用 cyc[0]=300ms，.s4 用 cyc[1]=500ms
    expect(html).toContain('duration: 0.3')
    expect(html).toContain('duration: 0.5')
  })

  it('enterBodyHardCut 未提取（undefined）→ 第一个正片段仍有转场，不误判成硬切', () => {
    const html = renderIndexHtml(withCycle({
      bodyCycle: [{ renderType: 'crossfade', durationMs: 300 }],
    }))
    expect(html).toContain(`tl.fromTo('.s2', { opacity: 0 }`)
  })

  it('回归红线：bodyCycle 缺省时输出与改动前一致（走全局众数那条老路径）', () => {
    const html = renderIndexHtml(flashData)
    expect(html).toContain(`tl.fromTo('.s2', { opacity: 0 }`)
  })
})
