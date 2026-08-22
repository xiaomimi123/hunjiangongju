import { describe, it, expect } from 'vitest'
import { imageKeyPool, imageConcurrency } from './image'

describe('imageKeyPool —— 多 Key 轮询池', () => {
  it('主 Key + extra.apiKeys 合并，去重去空', () => {
    expect(imageKeyPool('sk-main', { apiKeys: ['sk-b', ' sk-c ', '', 'sk-main', 42] }))
      .toEqual(['sk-main', 'sk-b', 'sk-c'])
  })
  it('没配 apiKeys → 只有主 Key（零回归）', () => {
    expect(imageKeyPool('sk-main', {})).toEqual(['sk-main'])
  })
  it('apiKeys 脏数据（非数组）→ 只有主 Key', () => {
    expect(imageKeyPool('sk-main', { apiKeys: 'sk-b' })).toEqual(['sk-main'])
  })
})

describe('imageConcurrency —— 并发数配置', () => {
  it('缺省 4（单 Key 账号的经验值）', () => {
    expect(imageConcurrency({})).toBe(4)
  })
  it('extra.concurrency 生效，取整并夹在 1~16', () => {
    expect(imageConcurrency({ concurrency: 8 })).toBe(8)
    expect(imageConcurrency({ concurrency: 8.6 })).toBe(9)
    expect(imageConcurrency({ concurrency: 99 })).toBe(16)
    expect(imageConcurrency({ concurrency: 0 })).toBe(1)
    expect(imageConcurrency({ concurrency: 'x' })).toBe(4)
  })
})
