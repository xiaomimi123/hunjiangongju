import { describe, it, expect } from 'vitest'
import { readCharHardCap } from './charHardCap'

describe('readCharHardCap', () => {
  it('读出框架里的硬上限', () => {
    expect(readCharHardCap({ __charHardCap: 156 }, 124)).toBe(156)
  })
  // 低于软预算的话，AI 刚好写到目标就会被裁
  it('低于软预算时抬到软预算', () => {
    expect(readCharHardCap({ __charHardCap: 80 }, 124)).toBe(124)
  })
  it('缺省/脏值 → null（调用方回退软预算，维持旧行为）', () => {
    expect(readCharHardCap({}, 124)).toBeNull()
    expect(readCharHardCap(null, 124)).toBeNull()
    expect(readCharHardCap({ __charHardCap: '156' }, 124)).toBeNull()
    expect(readCharHardCap({ __charHardCap: 0 }, 124)).toBeNull()
    expect(readCharHardCap({ __charHardCap: NaN }, 124)).toBeNull()
    expect(readCharHardCap('不是对象', 124)).toBeNull()
  })
})
