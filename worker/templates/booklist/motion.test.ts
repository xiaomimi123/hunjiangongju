import { describe, it, expect } from 'vitest'
import { MOVES, pickMove, moveTweens, TRANS, pickTrans, transTweens, shardGrid, shardOpeningTweens } from './motion'

describe('pickMove', () => {
  it('确定性、相邻 seqNo 不撞招', () => {
    expect(pickMove(1, 0)).toBe(pickMove(1, 0))
    expect(pickMove(1, 0)).not.toBe(pickMove(2, 0))
  })
  it('offset 移动轮换相位', () => {
    expect(pickMove(1, 0)).not.toBe(pickMove(1, 1))
  })
})

describe('moveTweens', () => {
  it('针对 .sN .photo，位置=startMs 秒，无 function-based 值', () => {
    const out = moveTweens('push-in', 2, 2000, 4500, false)
    expect(out).toContain(".s2 .photo'")
    expect(out).toContain(', 2)') // 起点秒
    expect(out).not.toContain('function')
    expect(out).not.toContain('=>')
  })
  it('末段 push-in 目标幅度更大(1.16)', () => {
    expect(moveTweens('push-in', 3, 4000, 6000, true)).toContain('scale: 1.16')
    expect(moveTweens('push-in', 1, 0, 2000, false)).toContain('scale: 1.105')
  })
  it('每种招式都能产出针对 .photo 的 tween', () => {
    for (const m of MOVES) {
      const out = moveTweens(m, 1, 0, 2000, false)
      expect(out).toContain(".s1 .photo'")
      expect(out).toContain('duration:')
    }
  })
})

describe('pickTrans', () => {
  it('确定性、相邻边界不撞', () => {
    expect(pickTrans(2, 0)).toBe(pickTrans(2, 0))
    expect(pickTrans(2, 0)).not.toBe(pickTrans(3, 0))
  })
})

describe('transTweens', () => {
  it('每种转场都落在 boundarySec 起的 0.72s 窗内，且操作新旧场景', () => {
    for (const tr of TRANS) {
      const out = transTweens(tr, 2, 2000)
      expect(out).toContain('.s2') // 新场景
      expect(out).toContain('.s1') // 旧场景
      expect(out).not.toContain('function')
      expect(out).not.toContain('=>')
      // 位置起点为 2 秒（boundaryMs=2000）
      expect(out).toContain(', 2)')
    }
  })
  it('crossfade：新场景淡入、旧场景淡出', () => {
    const out = transTweens('crossfade', 2, 2000)
    expect(out).toContain("tl.fromTo('.s2', { opacity: 0 }, { opacity: 1, duration: 0.72")
    expect(out).toContain("tl.to('.s1', { opacity: 0, duration: 0.72")
  })
  it('shard：驱动 .ts2 碎片层', () => {
    expect(transTweens('shard', 2, 2000)).toContain(".ts2 .shard'")
  })
})

describe('shardGrid', () => {
  it('cols×rows 片、烘焙内联、无 Math.random', () => {
    const html = shardGrid({ containerClass: 'shatter s1shatter', imgSrc: 'media/01.png', cols: 4, rows: 5, width: 720, height: 960, startScattered: true })
    expect((html.match(/class="shard"/g) ?? []).length).toBe(20)
    expect(html).toContain("background-image:url('media/01.png');background-size:720px 960px")
    expect(html).toContain('transform:translate(')
    expect(html).not.toContain('Math.random')
  })
})

describe('shardOpeningTweens', () => {
  it('t=0 起碎片归位、真实图隐藏后淡入接手', () => {
    const out = shardOpeningTweens()
    expect(out).toContain("tl.set('.s1 .photo', { opacity: 0 }, 0);")
    expect(out).toContain("tl.to('.s1shatter .shard'")
    expect(out).toContain("stagger: { amount: 0.45, from: 'center' } }, 0);")
  })
})
