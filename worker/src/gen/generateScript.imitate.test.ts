import { describe, it, expect } from 'vitest'
import { buildImitatePrompt } from './generateScript'

const fw = { frameworkText: '框架说明', segCount: 6, maxLines: 21, maxTotalChars: 220 }

describe('buildImitatePrompt', () => {
  const p = buildImitatePrompt({ reference: '一生中与你相处时间最长的就是你自己。', subject: '自我接纳', framework: fw })
  it('包含参考文案与"仿写/模仿"指令', () => {
    expect(p).toContain('一生中与你相处时间最长的就是你自己')
    expect(p).toMatch(/仿写|模仿|照.*风格/)
  })
  it('要求原创改写、不照抄参考', () => {
    expect(p).toMatch(/不.*照抄|原创改写/)
  })
  it('带字数/行数预算与风格准则(无CTA)', () => {
    expect(p).toContain('220')
    expect(p).toContain('21')
    expect(p).toMatch(/CTA|购物车|关注/) // STYLE_RULES 里的禁 CTA 条款
  })
})

describe('buildImitatePrompt —— 开场白（flash 模板遗漏补齐）', () => {
  it('传 openTitleText 时要求首段为开场白且含该标题，风格准则首条改为「开场白之后」', () => {
    const p = buildImitatePrompt({
      reference: '一生中与你相处时间最长的就是你自己。',
      subject: '自我接纳',
      framework: fw,
      openTitleText: '今天分享的是',
    })
    expect(p).toContain('今天分享的是')
    expect(p).toContain('开场白')
    expect(p).toContain('开场白之后的第一句直击情绪')
    expect(p).not.toContain('开篇第一句直击情绪')
  })

  it('回归红线：不传 openTitleText 时，输出与改动前逐字节相同', () => {
    const args = { reference: '一生中与你相处时间最长的就是你自己。', subject: '自我接纳', framework: fw }
    const p = buildImitatePrompt(args)
    // 以下常量取自 git show HEAD:worker/src/gen/generateScript.ts（改动前版本）逐字节抄出，
    // 而非对同一次调用做同义反复的自比较——保证真的能捕捉到未来对 buildImitatePrompt 的意外改动。
    const EXPECTED = [
      '你是一名书单号短视频文案写手。请【仿照】下面这段【参考文案】的语气、句式、情感浓度与第二人称口吻，就同一主题原创改写一条新文案。',
      '',
      `参考文案（模仿其风格与节奏，不要照抄内容）：\n${args.reference}`,
      `主题：${args.subject}`,
      `文案框架：\n${fw.frameworkText}`,
      '',
      '要求：',
      `1. 分成约 ${fw.segCount} 段，每句单独一行；第二人称口吻，围绕一个核心主题贯穿，不逐本介绍、不讲故事情节。`,
      '2. 只输出文案正文，不要编号、不要标题、不要任何解释说明。',
      '3. 必须原创改写，严禁照抄参考文案或框架示例。',
      `4. 总字数不超过 ${fw.maxTotalChars} 字，总行数不超过 ${fw.maxLines} 行。`,
      '',
      '文案风格准则（务必遵守）：\n' +
        '- 开篇第一句直击情绪、给一个具体场景或画面，不要先介绍书或说"今天推荐"。\n' +
        '- 短句、口语化、像跟朋友说话；多用具体细节，少用抽象大词。\n' +
        '- 严禁"你是不是……"式营销开头、"不是……而是……"的对仗论证、机械排比。\n' +
        '- 结尾留余味、给一句能被记住的话；严禁任何 CTA（买它/点购物车/关注/链接）。',
    ].join('\n')
    expect(p).toBe(EXPECTED)
  })

  it('条目编号：传/不传 openTitleText 时「要求：」列表编号连续、无重号无跳号', () => {
    const withTitle = buildImitatePrompt({
      reference: '一生中与你相处时间最长的就是你自己。',
      subject: '自我接纳',
      framework: fw,
      openTitleText: '今天分享的是',
    })
    const without = buildImitatePrompt({ reference: '一生中与你相处时间最长的就是你自己。', subject: '自我接纳', framework: fw })

    function extractNumbers(p: string): number[] {
      const start = p.indexOf('要求：')
      const end = p.indexOf('\n\n', start)
      const block = p.slice(start, end === -1 ? undefined : end)
      return [...block.matchAll(/^(\d+)\./gm)].map((m) => Number(m[1]))
    }

    const withNums = extractNumbers(withTitle)
    const withoutNums = extractNumbers(without)
    // eslint-disable-next-line no-console
    console.log('--- buildImitatePrompt 完整提示词（传 openTitleText）---\n' + withTitle)
    // eslint-disable-next-line no-console
    console.log('--- buildImitatePrompt 完整提示词（不传 openTitleText）---\n' + without)
    // eslint-disable-next-line no-console
    console.log('传 openTitleText 编号：', withNums)
    // eslint-disable-next-line no-console
    console.log('不传 openTitleText 编号：', withoutNums)

    expect(withNums).toEqual(Array.from({ length: withNums.length }, (_, i) => i + 1))
    expect(withoutNums).toEqual(Array.from({ length: withoutNums.length }, (_, i) => i + 1))
    expect(withNums.length).toBe(withoutNums.length + 1)
  })
})
