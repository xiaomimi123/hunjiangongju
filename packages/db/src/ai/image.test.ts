import { describe, it, expect } from 'vitest'
import { toDashSize } from './image'
import { dashCompatBase } from './dashscope'

// ★ 百炼分支原先**完全忽略**调用方传的 size，写死 `extra.size ?? '1024*1024'`。
// 后果:模型按正方形构图 → 我们 cover 裁成 9:12 竖屏 → 左右各砍掉 12.5%,
// 人物特写的脸经常被裁到边上。那不是模型差,是我们自己把画面切了。
describe('toDashSize —— 生图尺寸按调用方的比例换算', () => {
  const ratio = (s: string) => {
    const [w, h] = s.split('*').map(Number)
    return w / h
  }

  // 比例必须**精确**保住,这是这个函数存在的唯一理由。
  // 第一版按面积缩放后各自对齐 64,720×960(3:4) 变成 896×1152(0.778) —— 比例没保住,
  // 出图照样要被裁,等于白改。
  it('保住调用方的比例', () => {
    expect(ratio(toDashSize('720x960'))).toBeCloseTo(0.75, 4)
    expect(ratio(toDashSize('1080x1920'))).toBeCloseTo(0.5625, 4)
    expect(ratio(toDashSize('1280x720'))).toBeCloseTo(1280 / 720, 4)
    expect(ratio(toDashSize('1024x1024'))).toBeCloseTo(1, 4)
  })

  // 扩散模型的潜空间按 64 分块,非整倍数的边长要么被拒、要么内部取整后变形
  it('边长都是 64 的整数倍', () => {
    for (const s of ['720x960', '1080x1920', '1024x1024', '1280x720']) {
      const [w, h] = toDashSize(s).split('*').map(Number)
      expect(w % 64, `${s} 宽 ${w} 不是 64 的整数倍`).toBe(0)
      expect(h % 64, `${s} 高 ${h} 不是 64 的整数倍`).toBe(0)
    }
  })

  it('输出百炼要的 W*H 格式,不是 WxH', () => {
    expect(toDashSize('720x960')).toMatch(/^\d+\*\d+$/)
  })

  // 尺寸太小模型出图会糊;1024 级别是这类模型的标定档位
  it('面积在百万像素量级', () => {
    for (const s of ['720x960', '1080x1920', '1280x720']) {
      const [w, h] = toDashSize(s).split('*').map(Number)
      expect(w * h).toBeGreaterThan(500_000)
      expect(w * h).toBeLessThan(2_000_000)
    }
  })

  it('缺省/非法输入回退竖屏 3:4,不回退正方形', () => {
    expect(toDashSize(undefined)).toBe('768*1024')
    expect(toDashSize('')).toBe('768*1024')
    expect(toDashSize('bad')).toBe('768*1024')
    expect(toDashSize('0x0')).toBe('768*1024')
  })
})

// 换模型最常见的失败是「Model not exist」,而它既可能是模型名写错、
// 也可能是这个端点不服务该模型(MAAS 专属端点只服务你部署上去的那几个)。
// 少了端点与模型名这两条信息就没法区分 —— 所以拼 base 的规则要有断言守着。
describe('dashCompatBase —— 列模型用的兼容模式地址', () => {
  it('裸域名补上 /compatible-mode/v1', () => {
    expect(dashCompatBase('https://dashscope.aliyuncs.com')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('已带兼容模式路径的原样保留（MAAS 专属端点就是这种）', () => {
    const maas = 'https://ws-x.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
    expect(dashCompatBase(maas)).toBe(maas)
  })

  it('容忍结尾斜杠', () => {
    expect(dashCompatBase('https://dashscope.aliyuncs.com/')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(dashCompatBase('https://x.com/compatible-mode/v1/')).toBe('https://x.com/compatible-mode/v1')
  })

  it('地址非法时回退官方域名，不抛错', () => {
    expect(dashCompatBase('')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(dashCompatBase('不是地址')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })
})
