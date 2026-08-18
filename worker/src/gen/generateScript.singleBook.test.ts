import { describe, it, expect } from 'vitest'
import { buildSingleBookPrompt } from './generateScript'

const framework = { frameworkText: '框架示例：开头钩子+逐段展开', segCount: 7, maxLines: 21, maxTotalChars: 220 }
const book = { title: '被讨厌的勇气', author: '岸见一郎、古贺史健', points: '课题分离' }

describe('buildSingleBookPrompt', () => {
  it('含书名、作者、要点', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('被讨厌的勇气')
    expect(p).toContain('岸见一郎、古贺史健')
    expect(p).toContain('课题分离')
  })

  it('硬性约束：只讲这一本，不得提及其他书籍', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('只讲')
    expect(p).toContain('不得提及')
  })

  it('传 openTitleText 时要求首段以「今天分享的是《书名》」开场', () => {
    const p = buildSingleBookPrompt({ book, framework, openTitleText: '今天分享的是' })
    expect(p).toContain('今天分享的是《被讨厌的勇气》')
    expect(p).toContain('开场白')
    expect(p).toContain('开场白之后的第一句直击情绪')
    expect(p).not.toContain('开篇第一句直击情绪')
  })

  it('不传 openTitleText 时风格准则用原文首条', () => {
    const p = buildSingleBookPrompt({ book, framework })
    expect(p).toContain('开篇第一句直击情绪')
    expect(p).not.toContain('开场白')
  })

  it('不含书序号格式要求（单本无需标记）', () => {
    for (const p of [
      buildSingleBookPrompt({ book, framework }),
      buildSingleBookPrompt({ book, framework, openTitleText: '今天分享的是' }),
    ]) {
      expect(p).not.toContain('书序号')
    }
  })

  it('无作者/无要点时不输出空字段', () => {
    const p = buildSingleBookPrompt({ book: { title: '某书' }, framework })
    expect(p).toContain('某书')
    expect(p).not.toContain('作者：')
    expect(p).not.toContain('要点：')
  })

  it('带 angle 时进入提示词', () => {
    expect(buildSingleBookPrompt({ book, framework, angle: '故事式' })).toContain('故事式')
  })

  it('条目编号连续无重号', () => {
    for (const p of [
      buildSingleBookPrompt({ book, framework }),
      buildSingleBookPrompt({ book, framework, angle: '故事式', openTitleText: '今天分享的是' }),
    ]) {
      const nums = p.split('\n').map((l) => /^(\d+)\. /.exec(l)?.[1]).filter(Boolean).map(Number)
      expect(nums).toEqual(nums.map((_, i) => i + 1))
    }
  })
})
