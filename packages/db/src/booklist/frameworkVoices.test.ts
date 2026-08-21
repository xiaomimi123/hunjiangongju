import { describe, it, expect } from 'vitest'
import { readFrameworkVoices, allowVoiceForFramework } from './frameworkVoices'

// ★ 学员端原先一律剥离 voice（防盗用运营的私有克隆音色），但学员的正常流程
// 就是「填书名 + 选配音」，一刀切把流程堵死了。改成由框架声明开放哪些音色。
// **校验只认服务端读到的框架配置**——客户端传什么都不能信。
describe('框架允许的配音音色', () => {
  it('读出勾选的音色，保持勾选顺序', () => {
    expect(readFrameworkVoices({ __voices: { allowed: ['S_b', 'S_a'] } }).allowed).toEqual(['S_b', 'S_a'])
  })

  it('去重但保序', () => {
    expect(readFrameworkVoices({ __voices: { allowed: ['S_a', 'S_b', 'S_a'] } }).allowed).toEqual(['S_a', 'S_b'])
  })

  it('未配置 → 空名单（维持"一律用默认音色"的老行为）', () => {
    expect(readFrameworkVoices(null).allowed).toEqual([])
    expect(readFrameworkVoices({}).allowed).toEqual([])
    expect(readFrameworkVoices({ __voices: {} }).allowed).toEqual([])
    expect(readFrameworkVoices({ __voices: { allowed: 'S_a' } }).allowed).toEqual([])
  })

  it('脏项静默丢弃，不让一条坏数据废掉整个名单', () => {
    expect(readFrameworkVoices({ __voices: { allowed: ['S_a', '', 42, null, '  '] } }).allowed).toEqual(['S_a'])
  })

  // default 不在 allowed 里就丢掉：否则学员会拿到一个自己选不了的音色，
  // 而那正是「框架限制」要挡住的东西
  it('默认音色必须在名单里，否则忽略', () => {
    expect(readFrameworkVoices({ __voices: { allowed: ['S_a'], default: 'S_a' } }).default).toBe('S_a')
    expect(readFrameworkVoices({ __voices: { allowed: ['S_a'], default: 'S_别的' } }).default).toBeUndefined()
  })

  describe('allowVoiceForFramework —— 安全红线', () => {
    const fw = { __voices: { allowed: ['S_5sgd0dIc2'] } }

    it('名单内放行', () => {
      expect(allowVoiceForFramework(fw, 'S_5sgd0dIc2')).toBe('S_5sgd0dIc2')
    })

    it('名单外一律拒绝，哪怕格式完全合法', () => {
      expect(allowVoiceForFramework(fw, 'S_BSNb0dIc2')).toBeUndefined()
    })

    it('没开放名单时拒绝一切', () => {
      expect(allowVoiceForFramework({}, 'S_5sgd0dIc2')).toBeUndefined()
    })

    it('非字符串/空值不抛错', () => {
      expect(allowVoiceForFramework(fw, undefined)).toBeUndefined()
      expect(allowVoiceForFramework(fw, 42)).toBeUndefined()
      expect(allowVoiceForFramework(fw, '  ')).toBeUndefined()
    })
  })
})
