import { describe, it, expect } from 'vitest'
import { buildCoverPrompt, buildInnerPrompt, COVER_SHOT_MODES, INNER_COMPOSITIONS } from './photoPromptData'
import { parsePhotoTask } from './photoGen'
import { parseInnerPage } from './vision'

describe('buildCoverPrompt', () => {
  it('auto 模式：含匹配矩阵与通用配方，参考图为中性光锚点', () => {
    const { prompt, ref } = buildCoverPrompt('auto')
    expect(prompt).toContain('匹配规则')
    expect(prompt).toContain('权威封面原图')
    expect(prompt).toContain('4:5')
    expect(ref).toBe('approved-01-neutral-window-light.png')
  })

  it('每种具体拍法都有专属描述与参考图', () => {
    for (const mode of COVER_SHOT_MODES) {
      if (mode === 'auto') continue
      const { prompt, ref } = buildCoverPrompt(mode)
      expect(prompt).toContain('拍法为')
      expect(ref).toMatch(/\.(jpg|png)$/)
    }
  })

  it('lap_front 含腿部几何约束（素材包的关键 invariant）', () => {
    const { prompt } = buildCoverPrompt('lap_front')
    expect(prompt).toContain('V 形')
    expect(prompt).toContain('20-30%')
  })
})

describe('buildInnerPrompt', () => {
  it('拼入标题、页别、取景段、风格与场景（S01 带 WAL01）', () => {
    const p = buildInnerPrompt({ title: '远离消耗你的人际关系', pageSide: 'right', titleBand: 'lower', style: 'S01' })
    expect(p).toContain('「远离消耗你的人际关系」')
    expect(p).toContain('右页')
    expect(p).toContain(INNER_COMPOSITIONS.right_lower)
    expect(p).toContain('清透窗光风格')
    expect(p).toContain('胡桃木圆桌')
    expect(p).toContain('3:4')
  })

  it('S02 暗调不带 WAL01 场景', () => {
    const p = buildInnerPrompt({ title: 'x标题x', pageSide: 'left', titleBand: 'upper', style: 'S02' })
    expect(p).toContain('暗调风格')
    expect(p).not.toContain('胡桃木圆桌')
  })
})

describe('parsePhotoTask', () => {
  it('completed 响应取出 URL 列表（实测 2026-09-16 形状）', () => {
    const r = parsePhotoTask({ code: 200, data: { status: 'completed', result: { images: [{ url: ['https://a/x.png'] }] } } })
    expect(r).toEqual({ status: 'completed', urls: ['https://a/x.png'], error: undefined })
  })
  it('processing 无 URL', () => {
    const r = parsePhotoTask({ code: 200, data: { status: 'processing', progress: 50 } })
    expect(r.status).toBe('processing')
    expect(r.urls).toEqual([])
  })
})

describe('parseInnerPage', () => {
  const wrap = (text: string) => ({ output: { choices: [{ message: { content: text } }] } })
  it('合法 JSON → 分类结果', () => {
    expect(parseInnerPage(wrap('{"title":"他/她是在嫌弃我吗","side":"right","band":"middle"}')))
      .toEqual({ title: '他/她是在嫌弃我吗', pageSide: 'right', titleBand: 'middle' })
  })
  it('夹杂说明文字也能抠出 JSON', () => {
    expect(parseInnerPage(wrap('识别结果如下：{"title":"标题","side":"left","band":"upper"} 供参考')))
      .toEqual({ title: '标题', pageSide: 'left', titleBand: 'upper' })
  })
  it('side/band 非法 → null', () => {
    expect(parseInnerPage(wrap('{"title":"x","side":"top","band":"middle"}'))).toBeNull()
  })
})
