import { describe, it, expect } from 'vitest'
import { normalizeVariables, normalizeBooks, restrictVoiceForNonOperator } from './normalize'

describe('normalizeVariables', () => {
  it('variables 为空/undefined → undefined', () => {
    expect(normalizeVariables(undefined)).toBeUndefined()
    expect(normalizeVariables(null)).toBeUndefined()
  })

  it('含合法 voiceId（可能带首尾空白）→ trim 后保留', () => {
    expect(normalizeVariables({ voiceId: ' cosyvoice-v3-plus-abc123 ' })).toEqual({ voiceId: 'cosyvoice-v3-plus-abc123' })
  })

  it('voiceId 为空字符串/纯空白 → 从结果中剔除（未选音色，走通用音色）', () => {
    expect(normalizeVariables({ voiceId: '' })).toEqual({})
    expect(normalizeVariables({ voiceId: '   ' })).toEqual({})
  })

  it('books 与 voiceId 同时存在 → 都正确处理', () => {
    const r = normalizeVariables({ books: [{ title: '活下去的理由' }], voiceId: 'v-1' })
    expect(r).toEqual({ books: [{ title: '活下去的理由' }], voiceId: 'v-1' })
  })

  it('顶层非对象或为数组 → 抛错', () => {
    expect(() => normalizeVariables('not-an-object')).toThrow()
    expect(() => normalizeVariables(['a'])).toThrow()
  })
})

describe('normalizeBooks', () => {
  it('过滤空书名行，保留 author/points', () => {
    const r = normalizeBooks([{ title: '活下去的理由', author: '马特·海格' }, { title: '' }])
    expect(r).toEqual([{ title: '活下去的理由', author: '马特·海格' }])
  })

  it('全部为空书名 → 抛错', () => {
    expect(() => normalizeBooks([{ title: '' }])).toThrow()
  })

  it('非数组输入 → 抛错', () => {
    expect(() => normalizeBooks('not-an-array')).toThrow()
  })
})

describe('normalizeVariables — 自定义文案', () => {
  it('manual 模式：保留 scriptMode/customScript/bookTitle(trim)', () => {
    const v = normalizeVariables({ scriptMode: 'manual', customScript: '  句一。句二。 ', bookTitle: ' 活着 ' })
    expect(v?.scriptMode).toBe('manual')
    expect(v?.customScript).toBe('句一。句二。')
    expect(v?.bookTitle).toBe('活着')
  })
  it('imitate 模式同样要求 customScript', () => {
    expect(() => normalizeVariables({ scriptMode: 'imitate', customScript: '   ' })).toThrow()
  })
  it('manual 缺 customScript → 400', () => {
    expect(() => normalizeVariables({ scriptMode: 'manual' })).toThrow()
  })
  it('非法 scriptMode → 视为 auto(不设 scriptMode)，customScript 被忽略', () => {
    const v = normalizeVariables({ scriptMode: 'weird', customScript: 'x' })
    expect(v?.scriptMode).toBeUndefined()
  })
  it('auto(无 scriptMode) 不受影响', () => {
    const v = normalizeVariables({ voiceId: 'v-1' })
    expect(v?.scriptMode).toBeUndefined()
    expect(v?.voiceId).toBe('v-1')
  })
})

describe('normalizeVariables — 配图来源', () => {
  it('assetSource=library 且带 assetFolder(可能带首尾空白) → 透传并 trim', () => {
    const v = normalizeVariables({ assetSource: 'library', assetFolder: '  旅行  ' })
    expect(v?.assetSource).toBe('library')
    expect(v?.assetFolder).toBe('旅行')
  })
  it('assetSource=library 但 assetFolder 空/纯空白 → 保留 source，剔除 folder', () => {
    const v1 = normalizeVariables({ assetSource: 'library' })
    expect(v1?.assetSource).toBe('library')
    expect(v1?.assetFolder).toBeUndefined()
    const v2 = normalizeVariables({ assetSource: 'library', assetFolder: '   ' })
    expect(v2?.assetSource).toBe('library')
    expect(v2?.assetFolder).toBeUndefined()
  })
  it('非法 assetSource(含 "ai"/其它) → 剔除 assetSource 与 assetFolder', () => {
    const v = normalizeVariables({ assetSource: 'ai', assetFolder: '旅行' })
    expect(v?.assetSource).toBeUndefined()
    expect(v?.assetFolder).toBeUndefined()
  })
  it('缺省 assetSource → 不设该字段', () => {
    const v = normalizeVariables({ voiceId: 'v-1' })
    expect(v?.assetSource).toBeUndefined()
  })
})

describe('restrictVoiceForNonOperator', () => {
  it('学员（student）→ 剔除 voice 与 voiceId，其余字段原样保留', () => {
    const r = restrictVoiceForNonOperator('student', { voice: 'S_clonevoice', voiceId: 'cosyvoice-abc', bookTitle: '活着' })
    expect(r).toEqual({ bookTitle: '活着' })
  })

  it('非 operator 的任意角色 → 同样剔除', () => {
    const r = restrictVoiceForNonOperator('guest', { voice: 'S_x', voiceId: 'v-1' })
    expect(r).toEqual({})
  })

  it('运营（operator）→ voice 与 voiceId 原样保留', () => {
    const r = restrictVoiceForNonOperator('operator', { voice: 'S_clonevoice', voiceId: 'cosyvoice-abc', bookTitle: '活着' })
    expect(r).toEqual({ voice: 'S_clonevoice', voiceId: 'cosyvoice-abc', bookTitle: '活着' })
  })

  it('variables 为 undefined → 原样返回 undefined（不抛错）', () => {
    expect(restrictVoiceForNonOperator('student', undefined)).toBeUndefined()
  })

  it('variables 中无 voice/voiceId → 其余字段不受影响', () => {
    const r = restrictVoiceForNonOperator('student', { bookTitle: '活着' })
    expect(r).toEqual({ bookTitle: '活着' })
  })

  // ★ 学员端的正常流程就是「填书名 + 选配音」，一律剥离等于把这个流程堵死。
  // 改成由**框架**声明哪些音色对学员开放：在名单里的放行，不在的照样剥离。
  it('框架开放的音色 → 学员可用', () => {
    const r = restrictVoiceForNonOperator('student', { voice: 'S_5sgd0dIc2', bookTitle: '活着' }, ['S_5sgd0dIc2'])
    expect(r).toEqual({ voice: 'S_5sgd0dIc2', bookTitle: '活着' })
  })

  // 这条是安全红线：客户端传什么都不能信，只认服务端读到的框架名单
  it('不在名单里的音色 → 照样剥离（哪怕格式合法）', () => {
    const r = restrictVoiceForNonOperator('student', { voice: 'S_别人的音色' }, ['S_5sgd0dIc2'])
    expect(r).toEqual({})
  })

  it('名单为空 → 维持"一律用默认音色"的老行为', () => {
    expect(restrictVoiceForNonOperator('student', { voice: 'S_x' }, [])).toEqual({})
    expect(restrictVoiceForNonOperator('student', { voice: 'S_x' })).toEqual({})
  })

  // voiceId 走的是 CosyVoice 那条路径，没有对应的框架级白名单，
  // 放开等于绕过这里的限制
  it('voiceId 仍然一律剥离，即使音色名单非空', () => {
    const r = restrictVoiceForNonOperator('student', { voice: 'S_ok', voiceId: 'cosyvoice-abc' }, ['S_ok'])
    expect(r).toEqual({ voice: 'S_ok' })
  })
})
