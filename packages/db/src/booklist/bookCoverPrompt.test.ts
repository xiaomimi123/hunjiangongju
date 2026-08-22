import { describe, it, expect } from 'vitest'
import { buildBookCoverPrompt } from './bookCoverPrompt'

describe('buildBookCoverPrompt', () => {
  it('产出封面底图诉求 + 无文字诉求，且正向不含书名文本', () => {
    const { prompt, negativePrompt } = buildBookCoverPrompt({ title: '活着', author: '余华' })
    expect(prompt).toMatch(/book cover|封面/)
    expect(prompt).toContain('no text')
    expect(prompt).not.toContain('活着') // 书名绝不进正向(避免AI画字)
    expect(prompt).not.toContain('余华')
  })
  it('负面词包含压制文字的关键词(中英)', () => {
    const { negativePrompt } = buildBookCoverPrompt({ title: 'X' })
    for (const w of ['text', 'letters', 'title', '文字', '字']) expect(negativePrompt).toContain(w)
  })
  it('styleHint 注入正向', () => {
    expect(buildBookCoverPrompt({ title: 'X' }, '复古摄影').prompt).toContain('复古摄影')
  })
})


describe('框架专属书封提示词（customPrompt）', () => {
  it('给了完整画面描述 → 不再用文艺封面外壳', () => {
    const { prompt } = buildBookCoverPrompt({ title: '活着' }, '梵高', '水墨山水意境，宣纸质感')
    expect(prompt).toContain('水墨山水意境，宣纸质感')
    expect(prompt, '外壳没被换掉').not.toContain('literary book cover background')
    expect(prompt).not.toContain('优雅抽象构图')
  })
  // 功能性约束不归运营调：书名标题要叠在底图上，留白和禁文字丢了会糊成一团
  it('功能性约束保留：中央留白 + 禁文字 + 负向提示词', () => {
    const { prompt, negativePrompt } = buildBookCoverPrompt({ title: '活着' }, undefined, '赛博朋克霓虹')
    expect(prompt).toContain('中央留出空白标题区')
    expect(prompt).toContain('no text')
    expect(negativePrompt).toContain('watermark')
  })
  // ★ 自定义提示词的负向词**只禁文字，不禁人物**。禁人物是默认抽象外壳的保险；
  // 运营写「文学名著的封面」这类画面很可能就要人物，带着人物禁令等于把提示词砍半
  //（线上实测：同一段提示词直接调模型效果好、走后台差很多，这就是差异源）。
  it('自定义提示词 → 负向词不禁人物；默认外壳 → 仍禁', () => {
    const custom = buildBookCoverPrompt({ title: '活着' }, undefined, '文学名著封面，人物剪影')
    expect(custom.negativePrompt).not.toContain('人物')
    expect(custom.negativePrompt).not.toContain('portrait')
    expect(custom.negativePrompt, '禁文字是功能性的，必须保留').toContain('watermark')
    const preset = buildBookCoverPrompt({ title: '活着' }, '梵高')
    expect(preset.negativePrompt).toContain('人物')
  })
  it('customPrompt 为空/空白 → 回退外壳（零回归）', () => {
    const a = buildBookCoverPrompt({ title: '活着' }, '梵高')
    const b = buildBookCoverPrompt({ title: '活着' }, '梵高', '   ')
    expect(b).toEqual(a)
  })
})
