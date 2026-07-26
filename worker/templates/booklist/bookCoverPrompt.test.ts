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
