import { describe, it, expect } from 'vitest'
import { parseVisionStyle } from './vision'

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
