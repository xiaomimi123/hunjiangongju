import { describe, it, expect } from 'vitest'
import {
  buildShatterMaps, buildShatterArgs, buildShards, shardPoseAt, forwardPoint, DEFAULT_GEOM,
} from './shatterMaps'

// ★ 必须用**生产尺寸**跑。第一版图快用了 120×160，结果两条断言假绿：
// 凹四边形漏掉的那条缝在小画布上不足 1 像素、被取整吃掉，
// 而 720×960 上同一条缝有 6 倍宽、肉眼可见。几何 bug 的可见性是随尺寸缩放的。
const G = { width: 720, height: 960, fps: 30, durationMs: 2159, ...DEFAULT_GEOM }
const OUT_OF_RANGE = 65535

const maps = buildShatterMaps(G)
const shards = buildShards(G)
const PX = G.width * G.height
const frameX = (f: number) => maps.xmap.subarray(f * PX * 2, (f + 1) * PX * 2)
const frameY = (f: number) => maps.ymap.subarray(f * PX * 2, (f + 1) * PX * 2)
const frameB = (f: number) => maps.bloom.subarray(f * PX, (f + 1) * PX)
const LAST = maps.frames - 1

const coverage = (f: number) => {
  const x = frameX(f)
  let c = 0
  for (let i = 0; i < PX; i++) if (x.readUInt16LE(i * 2) !== OUT_OF_RANGE) c++
  return c / PX
}

describe('碎裂坐标表', () => {
  // ★ 落位后必须严丝合缝。第一版用「叉积同号」判点在四边形内，那是**凸**多边形的判定；
  // 顶点抖动会让个别单元变成凹四边形（48 片里实测有 1 片），凹角那侧既不被本片认领、
  // 也不被邻片认领，成片上就是一条黑线。
  it('落位后没有一个像素无人认领', () => {
    const x = frameX(LAST)
    let holes = 0
    for (let i = 0; i < PX; i++) if (x.readUInt16LE(i * 2) === OUT_OF_RANGE) holes++
    expect(holes, '落位后仍有像素取不到源图，画面会出现黑缝').toBe(0)
  })

  it('落位后是恒等映射：每个像素取自源图同一位置', () => {
    const x = frameX(LAST)
    const y = frameY(LAST)
    let wrong = 0
    for (let Y = 0; Y < G.height; Y++) {
      for (let X = 0; X < G.width; X++) {
        const i = Y * G.width + X
        if (x.readUInt16LE(i * 2) !== X || y.readUInt16LE(i * 2) !== Y) wrong++
      }
    }
    expect(wrong, '落位后画面与原图不重合').toBe(0)
  })

  // ★ 飞行中的帧才验得出逆变换写对没有。
  // 落位那一帧缩放=1、旋转=0，「先撤旋转再撤缩放」和「先撤缩放再撤旋转」结果一样，
  // 只看落位帧的话把顺序写反了照样全绿（第一版就是这么假绿的）。
  //
  // 验法：拿映射表给出的源坐标 (u,v)，用**正变换**推回输出坐标，必须落回原像素。
  // 正变换与逆变换是两段独立代码，顺序错了合成就不是恒等，这里就红。
  it('飞行中：正变换能把映射表的源坐标推回原像素（逆变换的顺序正确）', () => {
    const f = Math.round(LAST * 0.45)
    const t = f / LAST
    const poses = shards.map((s) => shardPoseAt(s, t))
    // 断言前先确认这一帧确实在"变形中"，否则测试是空转的
    const deformed = poses.filter((p) => p.progress > 0 && (Math.abs(p.ang) > 0.15 || p.sx < 0.9))
    expect(deformed.length, '选的帧没有碎片在变形，这条断言验不到东西').toBeGreaterThan(10)

    const x = frameX(f)
    const y = frameY(f)
    let checked = 0
    let bad = 0
    for (let i = 0; i < PX; i += 13) {
      const u = x.readUInt16LE(i * 2)
      if (u === OUT_OF_RANGE) continue
      const v = y.readUInt16LE(i * 2)
      const X = i % G.width
      const Y = Math.floor(i / G.width)
      checked++
      // 源坐标落在哪片里就用哪片的姿态推回去；碎片之间只有 0.6px 重叠，
      // 逐一试过去总有一片能对上——一片都对不上就是逆变换错了
      const ok = shards.some((s, si) => {
        if (poses[si].progress <= 0) return false
        const p = forwardPoint(s, poses[si], u, v)
        return Math.abs(p.x - X) <= 1.5 && Math.abs(p.y - Y) <= 1.5
      })
      if (!ok) bad++
    }
    expect(checked, '这一帧几乎没有像素被写入，采样太稀').toBeGreaterThan(5000)
    expect(bad / checked, '正/逆变换不互逆，碎片会从图上错误的位置取色').toBeLessThan(0.01)
  })

  it('开头绝大部分画面还没有碎片飞到（一片黑）', () => {
    expect(coverage(0)).toBeLessThan(0.2)
  })

  it('画面逐渐被填满：中段覆盖率介于开头与落位之间', () => {
    const mid = coverage(Math.floor(LAST / 2))
    expect(mid).toBeGreaterThan(coverage(0))
    expect(mid).toBeLessThan(coverage(LAST))
  })

  // 过曝必须是**逐片**的：参考视频里飞行中的碎片近乎纯白、已落位的却是正常色彩，
  // 两者同屏共存。若退化成全局包络，同一帧内所有碎片的过曝值会一模一样。
  it('同一帧内不同碎片的过曝程度不同（逐片，而非全局包络）', () => {
    const b = frameB(Math.floor(LAST * 0.35))
    const vals = new Set<number>()
    for (let i = 0; i < PX; i++) if (b[i] > 0) vals.add(b[i])
    expect(vals.size, '同帧过曝值只有一种，说明过曝不是逐片的').toBeGreaterThan(1)
  })

  it('落位后过曝完全收干净（否则成片会比原图发白）', () => {
    let mx = 0
    const b = frameB(LAST)
    for (let i = 0; i < PX; i++) if (b[i] > mx) mx = b[i]
    expect(mx).toBe(0)
  })

  // 本仓禁用 Math.random：随机会让同一模板每次渲染都不同，出问题无法复现
  it('确定性：同参数两次生成逐字节一致', () => {
    const again = buildShatterMaps(G)
    expect(again.xmap.equals(maps.xmap)).toBe(true)
    expect(again.bloom.equals(maps.bloom)).toBe(true)
  })

  it('帧数 = 时长 × 帧率', () => {
    expect(maps.frames).toBe(65)
  })

  // 飞入距离曾被写死成 720×960 下的像素值，换画布就整个跑偏（小画布上碎片全程在画面外）
  it('飞入距离随画布缩放，不是写死的像素', () => {
    const big = buildShards({ ...G, width: 1440, height: 1920 })
    const r = (s: { dx: number; dy: number }) => Math.hypot(s.dx, s.dy)
    expect(r(big[0]) / r(shards[0])).toBeCloseTo(2, 1)
  })
})

describe('碎裂渲染参数', () => {
  const args = buildShatterArgs({
    imgAbs: '/a/img.png', width: 720, height: 960, fps: 30, durationMs: 2159,
    xmapAbs: '/m/x.mkv', ymapAbs: '/m/y.mkv', bloomAbs: '/m/b.mkv', outAbs: '/o/open.mp4',
  })
  const filter = args[args.indexOf('-filter_complex') + 1]

  it('四路输入按 remap 的约定排列：源图、xmap、ymap、过曝遮罩', () => {
    expect(args.filter((a) => a === '-i')).toHaveLength(4)
    expect(filter).toContain('[img][1:v][2:v]remap=fill=black')
  })

  // 缝隙靠 fill 填黑，不另做遮罩；丢了它碎片间会是拉伸的边缘像素
  it('缝隙填黑', () => {
    expect(filter).toContain('fill=black')
  })

  it('底图按 cover 铺满，不留黑边', () => {
    expect(filter).toContain('force_original_aspect_ratio=increase')
    expect(filter).toContain('crop=720:960')
  })

  it('产出无声，帧数按时长×帧率截断', () => {
    expect(args).toContain('-an')
    expect(args[args.indexOf('-frames:v') + 1]).toBe('65')
  })

  // 光晕由过曝遮罩派生 → 落位后遮罩归零、光晕自动消失。
  // 若改用时间开关卡窗口，切换那一帧必闪。
  it('光晕源自过曝遮罩而不是时间开关', () => {
    expect(filter).toContain('gblur')
    expect(filter).not.toContain('enable=')
  })
})
