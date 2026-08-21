import { describe, it, expect } from 'vitest'
import { parseVisionStyle, parseBooksResult , parseStylePrompt, MOCK_STYLE_PROMPT } from './vision'

describe('parseBooksResult', () => {
  const wrap = (text: string) => ({ output: { choices: [{ message: { content: text } }] } })
  it('从含解释的文本里抠出 JSON 书目并去书名号', () => {
    const r = parseBooksResult(wrap('识别到：[{"title":"《活下去的理由》","author":"马特·海格"}]'))
    expect(r).toEqual([{ title: '活下去的理由', author: '马特·海格' }])
  })
  it('作者缺省则省略 author；按书名去重', () => {
    const r = parseBooksResult(wrap('[{"title":"活着"},{"title":"活着","author":"余华"}]'))
    expect(r).toEqual([{ title: '活着' }])
  })
  it('无 JSON / 非数组 → 空', () => {
    expect(parseBooksResult(wrap('画面里没有书'))).toEqual([])
    expect(parseBooksResult(wrap('{"title":"x"}'))).toEqual([])
  })
})

// DashScope 原生多模态响应结构（核对自 https://help.aliyun.com/zh/model-studio/vision）：
// { output: { choices: [{ message: { content: [{ text }] } }] } }
function respWithText(text: string) {
  return { output: { choices: [{ message: { content: [{ text }] } }] } }
}

describe('parseVisionStyle（DashScope qwen-vl 画风响应解析，纯函数）', () => {
  it('从标准格式响应中提取画风描述与分类（厚涂油画/暗调 → oil_painting）', () => {
    const raw = respWithText('画风描述：厚涂油画质感，暗调电影感，情绪浓烈\n分类：oil_painting')
    expect(parseVisionStyle(raw)).toEqual({
      imageStylePrompt: '厚涂油画质感，暗调电影感，情绪浓烈',
      visualStyleType: 'oil_painting',
    })
  })

  it('分类标签缺失时，按中文关键词兜底归类（水彩 → watercolor）', () => {
    const raw = respWithText('画风描述：清新水彩插画风，柔和治愈')
    const r = parseVisionStyle(raw)
    expect(r.imageStylePrompt).toBe('清新水彩插画风，柔和治愈')
    expect(r.visualStyleType).toBe('watercolor')
  })

  it('既无分类标签也无关键词命中时，默认归类为 ai_illustration', () => {
    const raw = respWithText('画面呈现出简洁明快的风格')
    expect(parseVisionStyle(raw).visualStyleType).toBe('ai_illustration')
  })

  it('分类值不在词表内时，归一化为默认 ai_illustration（不信任模型乱造的分类）', () => {
    const raw = respWithText('画风描述：抽象拼贴风格\n分类：collage')
    expect(parseVisionStyle(raw).visualStyleType).toBe('ai_illustration')
  })

  it('响应内容为纯字符串（OpenAI 兼容格式）时同样可解析', () => {
    const raw = { output: { choices: [{ message: { content: '画风描述：暗调电影感，写实摄影质感\n分类：photo' } }] } }
    expect(parseVisionStyle(raw)).toEqual({
      imageStylePrompt: '暗调电影感，写实摄影质感',
      visualStyleType: 'photo',
    })
  })

  it('响应格式异常（缺 text）时兜底返回 mock 默认值，绝不抛错', () => {
    const raw = { output: {} }
    expect(parseVisionStyle(raw)).toEqual({
      imageStylePrompt: '厚涂油画质感,情绪化,统一画风',
      visualStyleType: 'oil_painting',
    })
  })
})

// ★ 参考图反推「生图用的」画风提示词。与 describeImageStyle 不同：
// 那个是拆解用的、只输出一句话概括并归到 5 类词表；这个要细到能复现风格。
describe('parseStylePrompt —— 参考图反推画风', () => {
  const dash = (text: string) => ({ output: { choices: [{ message: { content: [{ text }] } }] } })

  it('取出 DashScope 原生响应里的提示词', () => {
    expect(parseStylePrompt(dash('厚涂油画,可见笔触,暖褐色调,侧逆光,古典构图,沉静'))) 
      .toBe('厚涂油画,可见笔触,暖褐色调,侧逆光,古典构图,沉静')
  })

  it('取出 OpenAI 兼容响应里的提示词', () => {
    expect(parseStylePrompt({ choices: [{ message: { content: '水彩晕染,淡雅色调' } }] }))
      .toBe('水彩晕染,淡雅色调')
  })

  // 模型常自作主张加前缀或引号，直接塞进提示词会污染生图
  it('剥掉「画风提示词：」这类前缀与包裹的引号', () => {
    expect(parseStylePrompt(dash('画风提示词：厚涂油画,暖褐色调'))).toBe('厚涂油画,暖褐色调')
    expect(parseStylePrompt(dash('“水彩晕染,淡雅色调”'))).toBe('水彩晕染,淡雅色调')
  })

  it('只取第一行，丢掉模型追加的解释', () => {
    expect(parseStylePrompt(dash('厚涂油画,暖褐色调\n\n这种风格常见于古典肖像。'))).toBe('厚涂油画,暖褐色调')
  })

  // ★ 解析不出来必须返回 null，**不能**兜一句通用画风。
  // 第一版兜的是「厚涂油画质感,浓郁色彩…」——看起来完全像一次正常的反推结果，
  // 运营传一张动漫头像却拿回一句厚涂油画，根本分不清是模型读错了还是这步悄悄失败了。
  // 让它可见（调用方抛错并把原始响应带出来）比给个像样的假答案好排查得多。
  it('响应形状不对/为空 → 返回 null，不伪装成一次正常结果', () => {
    expect(parseStylePrompt(null)).toBeNull()
    expect(parseStylePrompt({})).toBeNull()
    expect(parseStylePrompt(dash('   '))).toBeNull()
    expect(parseStylePrompt(dash('')), '空串不该被当成有效提示词').toBeNull()
  })
})
