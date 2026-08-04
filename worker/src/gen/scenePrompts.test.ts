import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildSceneListPrompt, parseSceneList, buildSegmentImagePrompt, describeScenes, MOCK_SCENES } from './scenePrompts'

describe('buildSceneListPrompt', () => {
  it('包含画风、全部文案行和 JSON 输出指令', () => {
    const p = buildSceneListPrompt('梵高后印象派风格', ['第一句文案', '第二句文案'])
    expect(p).toContain('梵高后印象派风格')
    expect(p).toContain('第一句文案')
    expect(p).toContain('第二句文案')
    expect(p).toContain('JSON')
  })
})

describe('parseSceneList', () => {
  it('解析合法 JSON 数组并 trim', () => {
    expect(parseSceneList('[" 麦田里的旋转星空 ","海边老树"]', 2)).toEqual(['麦田里的旋转星空', '海边老树'])
  })

  it('剥掉 markdown 代码围栏后解析', () => {
    expect(parseSceneList('```json\n["雨后窗台的猫"]\n```', 1)).toEqual(['雨后窗台的猫'])
  })

  it('数量不足时用 null 补齐', () => {
    expect(parseSceneList('["只有一条"]', 3)).toEqual(['只有一条', null, null])
  })

  it('数量超出时截断', () => {
    expect(parseSceneList('["a","b","c"]', 2)).toEqual(['a', 'b'])
  })

  it('非数组或垃圾输出时全部为 null', () => {
    expect(parseSceneList('抱歉我无法完成', 2)).toEqual([null, null])
    expect(parseSceneList('{"scenes":[]}', 2)).toEqual([null, null])
  })

  it('空字符串与非字符串条目视为 null', () => {
    expect(parseSceneList('["  ", 42, "有效场景"]', 3)).toEqual([null, null, '有效场景'])
  })
})

describe('buildSegmentImagePrompt', () => {
  it('有场景描述时:画风+场景+禁文字,不包含文案原文', () => {
    const p = buildSegmentImagePrompt('厚涂油画质感', '星空下的麦田小路', '这本书教你走出低谷')
    expect(p).toContain('厚涂油画质感')
    expect(p).toContain('星空下的麦田小路')
    expect(p).toContain('文字')
    expect(p).not.toContain('这本书教你走出低谷')
  })

  it('场景为 null 时回退到文案意境引导', () => {
    const p = buildSegmentImagePrompt('厚涂油画质感', null, '这本书教你走出低谷')
    expect(p).toContain('厚涂油画质感')
    expect(p).toContain('这本书教你走出低谷')
    expect(p).toContain('文字')
  })
})

describe('describeScenes (mock 模式)', () => {
  let prevMock: string | undefined
  beforeEach(() => {
    prevMock = process.env.AI_MOCK
    process.env.AI_MOCK = '1'
  })
  afterEach(() => {
    if (prevMock === undefined) delete process.env.AI_MOCK
    else process.env.AI_MOCK = prevMock
  })

  it('mock 模式返回定长的固定场景,不发网络请求', async () => {
    const out = await describeScenes('任意画风', ['a', 'b', 'c', 'd', 'e'])
    expect(out).toHaveLength(5)
    for (const s of out) {
      expect(typeof s).toBe('string')
      expect(MOCK_SCENES).toContain(s)
    }
  })
})
