import { describe, it, expect } from 'vitest'
import { buildScriptPrompt } from './generateScript'

const framework = { frameworkText: '框架示例', segCount: 7, maxLines: 21, maxTotalChars: 220 }
const books = [{ title: '甲书', author: '甲作者' }, { title: '乙书' }]

describe('buildScriptPrompt —— 书序号格式（books 模式）', () => {
  it('books 模式要求逐行输出「书序号|文案」，并说明序号范围', () => {
    const p = buildScriptPrompt({ mode: 'books', subject: '成长', books, framework })
    expect(p).toContain('书序号|文案')
    expect(p).toContain('1-2')
  })

  it('subject 模式没有书单可编号 → 不含书序号格式要求', () => {
    const p = buildScriptPrompt({ mode: 'subject', subject: '成长', framework })
    expect(p).not.toContain('书序号|文案')
  })
})

describe('buildScriptPrompt —— 开场白与风格准则', () => {
  it('传 openTitleText 时要求首行为开场白且序号写 0', () => {
    const p = buildScriptPrompt({ mode: 'books', subject: '成长', books, framework, openTitleText: '今天分享的是' })
    expect(p).toContain('今天分享的是')
    expect(p).toContain('开场白')
  })

  it('传 openTitleText 时风格准则首条改为「开场白之后」，不再是「开篇第一句」', () => {
    const p = buildScriptPrompt({ mode: 'books', subject: '成长', books, framework, openTitleText: '今天分享的是' })
    expect(p).toContain('开场白之后的第一句直击情绪')
    expect(p).not.toContain('开篇第一句直击情绪')
  })

  it('subject 模式同样支持开场白（开场白与有无书单无关）', () => {
    const p = buildScriptPrompt({ mode: 'subject', subject: '成长', framework, openTitleText: '今天分享的是' })
    expect(p).toContain('开场白')
  })

  it('回归红线：不传 openTitleText 时风格准则段落逐字节等于今天的原文', () => {
    const EXPECTED = [
      '文案风格准则（务必遵守）：',
      '- 开篇第一句直击情绪、给一个具体场景或画面，不要先介绍书或说"今天推荐"。',
      '- 短句、口语化、像跟朋友说话；多用具体细节，少用抽象大词。',
      '- 严禁"你是不是……"式营销开头、"不是……而是……"的对仗论证、机械排比。',
      '- 结尾留余味、给一句能被记住的话；严禁任何 CTA（买它/点购物车/关注/链接）。',
    ].join('\n')
    for (const p of [
      buildScriptPrompt({ mode: 'books', subject: '成长', books, framework }),
      buildScriptPrompt({ mode: 'subject', subject: '成长', framework }),
    ]) {
      expect(p).toContain(EXPECTED)
    }
  })
})
