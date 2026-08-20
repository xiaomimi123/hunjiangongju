import { describe, it, expect } from 'vitest'
import {
  buildShatterMaps, buildShatterArgs, buildShards, buildGeometry,
  shardPoseAt, forwardPoint, DEFAULT_GEOM,
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
const frameS = (f: number) => maps.spec.subarray(f * PX, (f + 1) * PX)
const LAST = maps.frames - 1

const coverage = (f: number) => {
  const x = frameX(f)
  let c = 0
  for (let i = 0; i < PX; i++) if (x.readUInt16LE(i * 2) !== OUT_OF_RANGE) c++
  return c / PX
}

describe('碎裂坐标表', () => {
  // ★ 落位后必须严丝合缝。早先用「叉积同号」判点在多边形内，那是**凸**多边形的判定；
  // 当时的抖动格网会造出凹四边形，凹角那侧既不被本片认领、也不被邻片认领，
  // 成片上就是一条黑线。现在改用递归切割（块都是凸的）+ 射线法，两重保险。
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
    // 断言前先确认这一帧确实在"变形中"，否则测试是空转的。
    // 门槛按块数取比例——写死成绝对条数的话，改了块数这条守卫就会误报。
    const deformed = poses.filter((p) => p.progress > 0 && (Math.abs(p.ang) > 0.15 || p.sx < 0.9))
    expect(deformed.length, '选的帧没有碎片在变形，这条断言验不到东西')
      .toBeGreaterThan(shards.length * 0.4)

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

  // ★ 棱光落位后必须归零，否则成片第一张图上会永远留着一张发光的裂纹网
  it('落位后棱光完全收干净', () => {
    let mx = 0
    const s = frameS(LAST)
    for (let i = 0; i < PX; i++) if (s[i] > mx) mx = s[i]
    expect(mx, '落位帧仍有棱光，画面会留下发光裂纹').toBe(0)
  })

  // ★ 这条抓的是一个真出过的 bug：反光原本算成翻转角的 cos^14，
  // 而翻转角在落位时收敛到 0 ⇒ cos(0)=1 ⇒ **每片落位那一刻都被打满反光**，
  // 所有碎片的脸同时提亮成一片灰，暗色原图整个被吃掉。
  //
  // 「落位帧棱光为 0」那条抓不到它（那一帧 rimEnv 也是 0，正好掩盖）。
  // 要抓必须看**临落位**的帧：那时反光应该已经过去了，不该还在峰值。
  it('反光在临落位时已经过去，不是落位那一刻最亮', () => {
    const lit = (f: number) => {
      const s = frameS(f)
      let sum = 0
      for (let i = 0; i < PX; i++) sum += s[i]
      return sum / PX
    }
    // 各片 flashAt 铺在 0.16~0.62，换算到时间轴大致在前 60%
    const early = Math.round(LAST * 0.3)
    const nearLanding = Math.round(LAST * 0.72) // 绝大多数碎片 p>0.9，尚未落位
    expect(lit(nearLanding), '临落位反而最亮，说明反光峰位跟着落位走了')
      .toBeLessThan(lit(early) * 0.6)
  })

  // 本仓禁用 Math.random：随机会让同一模板每次渲染都不同，出问题无法复现
  it('确定性：同参数两次生成逐字节一致', () => {
    const again = buildShatterMaps(G)
    expect(again.xmap.equals(maps.xmap)).toBe(true)
    expect(again.bloom.equals(maps.bloom)).toBe(true)
    expect(again.spec.equals(maps.spec)).toBe(true)
  })

  it('帧数 = 时长 × 帧率', () => {
    expect(maps.frames).toBe(65)
  })

  // ★ 每个源像素恰好属于一块：这是逐像素归属图相对多边形切割的根本好处，
  // 不重不漏是构造保证的，不再依赖"多边形外扩"那种补丁。
  it('每个源像素恰好属于一块，不重不漏', () => {
    const geo = buildGeometry(G)
    const cnt = new Array(geo.shards.length).fill(0)
    for (let i = 0; i < PX; i++) {
      expect(geo.label[i]).toBeLessThan(geo.shards.length)
      cnt[geo.label[i]]++
    }
    expect(cnt.reduce((a, b) => a + b, 0)).toBe(PX)
    expect(Math.min(...cnt), '有空块').toBeGreaterThan(0)
  })

  // 要的是「几个大块拼接」而不是一堆同尺寸碎片：
  // 每次都切当前最大的那块等于在做平均，切完个个差不多大——所以改成在前三里轮着挑、
  // 且刀口必定偏心。这条断言守住那个意图。
  it('块的大小明显悬殊，不是一堆同尺寸碎片', () => {
    // 门槛按实测定：720×960 是 3.5 倍，9:16 的画布是 7.6 倍（画布越长切得越不均）。
    // 取 3 是"还看得出大小块"的下限，不是拍脑袋的整数。
    const sorted = shards.map((s) => s.pixels).sort((a, b) => b - a)
    expect(sorted[0] / sorted[sorted.length - 1], '最大块与最小块差得太少，看着像马赛克')
      .toBeGreaterThan(3)
  })

  // ★ 裂纹必须是**折线**：参考视频里一条缝有好几处转折，各段方向都不同。
  // 直线裂纹是上一版的毛病 —— 半平面裁剪只能切直线。
  //
  // 第一版这条断言是**假绿**：它数的是"不同裂缝之间走向有几种"，
  // 而各条直线本来就角度各异，改成直线照样通过。要验的是**同一条裂缝内部**会不会拐弯。
  //
  // 改法：按「标签对」分组拿到每一条缝，对它拟合一条直线，量 RMS 垂距。
  // 实测折线 0.3~5.3px（中位 1.88），单段直线 0.0~0.4px（中位 0.35）——区分度足够。
  it('同一条裂缝内部会拐弯，不是一条直线', () => {
    const geo = buildGeometry(G)
    const seams = new Map<string, { x: number; y: number }[]>()
    for (let y = 1; y < G.height - 1; y++) {
      for (let x = 1; x < G.width - 1; x++) {
        const i = y * G.width + x
        const l = geo.label[i]
        for (const j of [i + 1, i + G.width]) {
          const m = geo.label[j]
          if (m === l) continue
          const k = l < m ? `${l}-${m}` : `${m}-${l}`
          if (!seams.has(k)) seams.set(k, [])
          seams.get(k)!.push({ x, y })
        }
      }
    }
    const devs: number[] = []
    for (const pts of seams.values()) {
      if (pts.length < 200) continue // 太短的缝拟合没意义
      let mx = 0
      let my = 0
      for (const p of pts) { mx += p.x; my += p.y }
      mx /= pts.length
      my /= pts.length
      let sxx = 0
      let sxy = 0
      let syy = 0
      for (const p of pts) {
        const a2 = p.x - mx
        const b2 = p.y - my
        sxx += a2 * a2; sxy += a2 * b2; syy += b2 * b2
      }
      sxx /= pts.length; sxy /= pts.length; syy /= pts.length
      // 主方向 = 协方差矩阵最大特征值对应的特征向量
      const tr = sxx + syy
      const det = sxx * syy - sxy * sxy
      const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
      let vx = sxy
      let vy = lam - sxx
      const nn = Math.hypot(vx, vy) || 1
      vx /= nn; vy /= nn
      let acc = 0
      for (const p of pts) {
        const d = (p.x - mx) * -vy + (p.y - my) * vx
        acc += d * d
      }
      devs.push(Math.sqrt(acc / pts.length))
    }
    expect(devs.length, '取不到足够长的裂缝，这条断言验不到东西').toBeGreaterThan(8)
    const bent = devs.filter((d) => d > 2).length
    expect(bent / devs.length, `裂缝几乎都是直的（RMS 垂距 ${devs.map((d) => d.toFixed(1)).join(' ')}）`)
      .toBeGreaterThan(0.25)
  })

  it('块数就是配置的块数', () => {
    expect(shards).toHaveLength(DEFAULT_GEOM.pieces)
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
    xmapAbs: '/m/x.mkv', ymapAbs: '/m/y.mkv', bloomAbs: '/m/b.mkv', specAbs: '/m/s.mkv', outAbs: '/o/open.mp4',
  })
  const filter = args[args.indexOf('-filter_complex') + 1]

  it('五路输入按 remap 的约定排列：源图、xmap、ymap、过曝遮罩、棱光遮罩', () => {
    expect(args.filter((a) => a === '-i')).toHaveLength(5)
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

  // 玻璃感的判别特征是棱边一侧偏粉、另一侧偏蓝的色散镶边，靠 R/B 反向错开做
  it('棱光带色散镶边', () => {
    expect(filter).toContain('[4:v]')
    expect(filter).toMatch(/\[4:v\][^;]*rgbashift/)
  })
})
