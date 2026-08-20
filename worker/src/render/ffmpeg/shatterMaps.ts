// 开场碎裂的**坐标映射表**生成器 —— 让 ffmpeg 也能做「碎片带着本条片子自己的图飞入」。
//
// ── 为什么是映射表，而不是逐片拉滤镜链 ──
//
// 碎片必须带着**这条片子自己的图**，所以不能像水波纹那样预渲染成固定素材。
// 但反过来看：碎片的**几何运动**每条片子完全一样（形状与方向都由下标派生，不含随机）。
// 变的只是贴图。
//
// 所以把「每帧、每个输出像素该去源图哪个位置取色」算成一张坐标表，预渲染一次；
// 每条片子只做一次 `remap` 查表。remap 对超出范围的坐标填 `fill` 色——
// **碎片之间的缝隙自动就是黑的**，不用额外的遮罩。
//
// 逐片拉 48 条 crop→rotate→overlay 链也能做，但那是每条片子都要付的成本，
// 而且滤镜图长到没法调试。映射表是「一次性算几何、永久复用」。
//
// ── 3D 翻转怎么表达 ──
//
// remap 是二维查表，做不了真三维。但正交投影下，绕 Y 轴转 θ 的视觉效果**就是**
// 水平方向压缩 cos(θ)——所以用非等比缩放模拟翻转，观感上是一样的薄片感。

export interface ShatterGeom {
  width: number
  height: number
  fps: number
  durationMs: number
  /** 碎片块数。见 DEFAULT_GEOM 里为什么不用格网。 */
  pieces: number
}

/**
 * 默认切成 16 块。
 *
 * 第一版用 6×8=48 的抖动格网，裂纹又密又整齐——抖动再大，横平竖直的格子感也去不掉，
 * 而且 48 块每块太小，观感是"马赛克"不是"碎玻璃"。真玻璃是几条长裂纹把整块切成
 * 大小悬殊的几大块，所以改成递归切割（见 tessellate）。
 */
export const DEFAULT_GEOM = { pieces: 16 } as const

/**
 * 映射表格式/内容的版本号，进缓存键。
 *
 * 缓存键原先只含画布尺寸与时长。那样改了生成算法而键不变，服务器上会继续吃旧缓存——
 * 表现是「部署完了画面却没变」，而且查不到任何报错。**改动本文件里任何影响
 * 映射表数值的常量或算法，都要把这个号 +1。**
 */
export const SHATTER_MAPS_VERSION = 4

/** 碎片在整段时长的这个比例处合拢；之后留一点静置，避免刚落位就切场景 */
const ASSEMBLE_AT = 0.78
/** 每批起飞的间隔（占总时长比例）与批数 —— 决定「前几帧几乎全黑、之后越来越密」 */
const STAGGER = 0.055
const BATCHES = 6
/** 压缩下限：完全侧棱(cos=0)会让碎片消失成一条线，留一点厚度 */
const MIN_SQUASH = 0.12

export interface Shard {
  /** 形心（源图坐标）。旋转/缩放绕它做，星芒也画在它变换后的位置。 */
  cx: number
  cy: number
  /** 该片在源图里的包围盒，用来算它在输出画面上的扫描范围 */
  sx0: number
  sy0: number
  sx1: number
  sy1: number
  /** 该片占的像素数 */
  pixels: number
  dx: number
  dy: number
  rot: number
  rx: number
  ry: number
  startT: number
  /** 本片反光闪光的时刻（自身飞行进度 0..1 上的位置） */
  flashAt: number
}

/**
 * 碎片的几何：**逐像素归属图**，不是多边形。
 *
 * 为什么放弃多边形：多边形切割只能切**直线**，而参考视频里的裂纹是折线——
 * 一条缝里有好几处转折，各段方向都不同。半平面裁剪做不出这个。
 *
 * 换成逐像素之后，裂纹形状想多不规则都行，而且「每个像素恰好属于一块」
 * 是构造保证的：不重不漏不再依赖多边形外扩那种补丁。
 */
export interface ShatterGeometry {
  shards: Shard[]
  /** 源图每个像素属于哪一块 */
  label: Uint8Array
  /** 源图每个像素到最近裂缝的距离（像素）。棱光按它衰减。 */
  edgeDist: Float32Array
}

/** 确定性哈希，取值 0..1。本仓禁用 Math.random：随机会让同一模板每次渲染都不同。 */
function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = ((h ^ (h >> 13)) * 1274126177) | 0
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}

/** 一刀的最小占比：两侧都得留住这么多，否则只是削出一条碎渣 */
const MIN_SPLIT = 0.22
/** 折线的分段数与每段长度（占该块尺度的比例） */
const CRACK_SEGS = 16
const SEG_MIN = 0.10
const SEG_SPAN = 0.13
/** 每段相对基准方向的最大偏摆（弧度，约 ±25°）——折角的"折"就是它 */
const KINK = 0.88

/**
 * 用一条**折线**把某一块切成两半。
 *
 * 关键：每段方向是「基准方向 ± 有界扰动」，**不是逐段累加**。
 * 累加就是随机游走，折线拐着拐着会卷回去、横穿不过整块，
 * 结果一刀只削下一条碎渣（实测最大块能占到 89%）。
 */
function crackPolyline(
  step: number, cx: number, cy: number, ext: number,
): [number, number, number, number][] {
  const base = (((step * 137.5) % 180) * Math.PI) / 180 + Math.PI / 2
  // 刀口偏离形心，两半面积不等 —— 大小悬殊的几大块由此而来
  const offMag = (0.20 + hash01(step, 3) * 0.30) * ext * 0.5 * (step % 2 ? 1 : -1)
  let px = cx + Math.cos(base + Math.PI / 2) * offMag - Math.cos(base) * ext
  let py = cy + Math.sin(base + Math.PI / 2) * offMag - Math.sin(base) * ext
  const segs: [number, number, number, number][] = []
  for (let k = 0; k < CRACK_SEGS; k++) {
    const dir = base + (hash01(step, k * 7 + 1) - 0.5) * KINK
    const len = ext * (SEG_MIN + hash01(step, k * 11 + 5) * SEG_SPAN)
    const nx = px + Math.cos(dir) * len
    const ny = py + Math.sin(dir) * len
    segs.push([px, py, nx, ny])
    px = nx
    py = ny
  }
  return segs
}

/** 点在折线的哪一侧：取最近的那一段，用它的叉积定号 */
function sideOf(x: number, y: number, segs: [number, number, number, number][]): number {
  let bd = Infinity
  let best = segs[0]
  for (const s of segs) {
    const [ax, ay, bx, by] = s
    const vx = bx - ax
    const vy = by - ay
    const L2 = vx * vx + vy * vy
    let t = L2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / L2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ddx = x - (ax + t * vx)
    const ddy = y - (ay + t * vy)
    const d = ddx * ddx + ddy * ddy
    if (d < bd) { bd = d; best = s }
  }
  const [ax, ay, bx, by] = best
  return (bx - ax) * (y - ay) - (by - ay) * (x - ax)
}

/**
 * 到最近裂缝的距离（倒角距离变换，两趟扫描）。
 *
 * 画布四边也算裂缝：飞行中的碎片外沿也是断口，应该一圈都发光。
 * 落位后棱光包络归零，所以不会在成片边上留一圈亮框。
 */
function crackDistance(label: Uint8Array, W: number, H: number): Float32Array {
  const d = new Float32Array(W * H)
  const BIG = 1e9
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const l = label[i]
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1
      const seam = border
        || label[i - 1] !== l || label[i + 1] !== l
        || label[i - W] !== l || label[i + W] !== l
      d[i] = seam ? 0 : BIG
    }
  }
  const D1 = 1
  const D2 = Math.SQRT2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      let v = d[i]
      if (y > 0) {
        v = Math.min(v, d[i - W] + D1)
        if (x > 0) v = Math.min(v, d[i - W - 1] + D2)
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + D2)
      }
      if (x > 0) v = Math.min(v, d[i - 1] + D1)
      d[i] = v
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x
      let v = d[i]
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + D1)
        if (x > 0) v = Math.min(v, d[i + W - 1] + D2)
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + D2)
      }
      if (x < W - 1) v = Math.min(v, d[i + 1] + D1)
      d[i] = v
    }
  }
  return d
}

/**
 * 碎片几何：反复用折线把当前**面积前三**里的一块切成两半。
 *
 * 不能每次都切最大的那块——那等于在做平均，切完个个差不多大；
 * 在前三里轮着挑才留得下几块明显大的。
 */
export function buildGeometry(g: ShatterGeom): ShatterGeometry {
  const { width: W, height: H } = g
  const label = new Uint8Array(W * H)
  let n = 1

  interface Acc { pixels: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number }
  const measure = (): Acc[] => {
    const a: Acc[] = []
    for (let i = 0; i < n; i++) a.push({ pixels: 0, x0: W, y0: H, x1: -1, y1: -1, sx: 0, sy: 0 })
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = a[label[y * W + x]]
        t.pixels++
        t.sx += x
        t.sy += y
        if (x < t.x0) t.x0 = x
        if (y < t.y0) t.y0 = y
        if (x > t.x1) t.x1 = x
        if (y > t.y1) t.y1 = y
      }
    }
    return a
  }

  let acc = measure()
  // 步数上限：几何上每一刀都可能因两侧太小而作废，给个远高于所需的上限兜底，
  // 免得参数没调好时死循环
  for (let step = 0; n < g.pieces && step < g.pieces * 12; step++) {
    const rank = [...acc.keys()].sort((a, b) => acc[b].pixels - acc[a].pixels)
    const tgt = rank[step % Math.min(3, rank.length)]
    const t = acc[tgt]
    const ext = Math.hypot(t.x1 - t.x0, t.y1 - t.y0)
    const segs = crackPolyline(step, (t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, ext)

    const flip: number[] = []
    for (let y = t.y0; y <= t.y1; y++) {
      for (let x = t.x0; x <= t.x1; x++) {
        const i = y * W + x
        if (label[i] !== tgt) continue
        if (sideOf(x, y, segs) > 0) flip.push(i)
      }
    }
    // 两侧都得留住 MIN_SPLIT，否则这一刀只削出一条碎渣：换下一个角度重来
    if (flip.length < t.pixels * MIN_SPLIT || t.pixels - flip.length < t.pixels * MIN_SPLIT) continue
    for (const i of flip) label[i] = n
    n++
    acc = measure()
  }

  const diag = Math.hypot(W, H)
  const shards: Shard[] = acc.map((a, i) => {
    // 飞入方向按黄金角绕圈，保证四面八方都有来路。
    // 距离按**画布对角线**取比例，写死像素的话换个画布尺寸效果就整个跑偏。
    const ang = (i * 137.5 * Math.PI) / 180
    const dist = diag * (0.4333 + ((i * 53) % 320) / 1200)
    return {
      cx: a.sx / a.pixels,
      cy: a.sy / a.pixels,
      sx0: a.x0, sy0: a.y0, sx1: a.x1, sy1: a.y1,
      pixels: a.pixels,
      dx: Math.cos(ang) * dist,
      dy: Math.sin(ang) * dist - diag * 0.075,
      rot: (Math.sin(i * 1.31) * 120 * Math.PI) / 180,
      rx: (Math.cos(i * 0.97) * 84 * Math.PI) / 180,
      ry: (Math.sin(i * 1.63) * 84 * Math.PI) / 180,
      startT: STAGGER * (i % BATCHES),
      // 峰位逐片错开铺在 0.16~0.62，且都远离落位点，落位时反光必为 0
      flashAt: 0.16 + ((i * 37) % 100) / 100 * 0.46,
    }
  })
  return { shards, label, edgeDist: crackDistance(label, W, H) }
}

/** 只要碎片参数时用它（验收测试）。要映射表请用 buildShatterMaps。 */
export function buildShards(g: ShatterGeom): Shard[] {
  return buildGeometry(g).shards
}

/** 某片碎片在归一化时刻 t 的姿态。progress=1 表示已落位（此时是恒等变换）。 */
export interface ShardPose {
  dx: number
  dy: number
  /** 面内旋转角（弧度） */
  ang: number
  /** 水平/垂直压缩，模拟绕 Y/X 轴翻转的正交投影 */
  sx: number
  sy: number
  progress: number
}

/**
 * 逐片姿态。**只有这一处定义运动**，坐标表的逆变换和验收用的正变换都以它为准，
 * 免得两边各写一份、改了一边忘另一边。
 */
export function shardPoseAt(s: Shard, t: number): ShardPose {
  const span = Math.max(0.001, ASSEMBLE_AT - s.startT)
  const p = Math.min(1, Math.max(0, (t - s.startT) / span))
  // power3.out：起手快、落位稳
  const k = Math.pow(1 - p, 3)
  return {
    dx: s.dx * k,
    dy: s.dy * k,
    ang: s.rot * k,
    sx: Math.max(MIN_SQUASH, Math.abs(Math.cos(s.ry * k))),
    sy: Math.max(MIN_SQUASH, Math.abs(Math.cos(s.rx * k))),
    progress: p,
  }
}

/** 正变换：源图坐标 → 输出画面坐标。与 buildShatterMaps 的逆变换互为反函数。 */
export function forwardPoint(
  s: Shard, pose: ShardPose, u: number, v: number,
): { x: number; y: number } {
  const ux = (u - s.cx) * pose.sx
  const uy = (v - s.cy) * pose.sy
  const ca = Math.cos(pose.ang)
  const sa = Math.sin(pose.ang)
  return {
    x: ux * ca - uy * sa + s.cx + pose.dx,
    y: ux * sa + uy * ca + s.cy + pose.dy,
  }
}

/**
 * 在遮罩上画一个四角星芒（叠加，饱和到 255）。
 *
 * 画在**输出画面**坐标系上、不裁到碎片范围内 —— 星芒本来就该溢到碎片外的黑底上，
 * 那正是镜头炫光的样子。
 */
function drawStar(
  buf: Buffer, base: number, W: number, H: number,
  cx: number, cy: number, radius: number, peak: number,
): void {
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(W - 1, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(H - 1, Math.ceil(cy + radius))
  const thin = Math.max(1, radius * 0.055) // 星芒的"细"——越小芒线越锐
  const core = Math.max(1, radius * 0.09)
  for (let Y = y0; Y <= y1; Y++) {
    const dy = Math.abs(Y - cy)
    for (let X = x0; X <= x1; X++) {
      const dx = Math.abs(X - cx)
      const horiz = Math.exp(-dy / thin) * Math.exp(-dx / radius)
      const vert = Math.exp(-dx / thin) * Math.exp(-dy / radius)
      const hot = Math.exp(-Math.hypot(dx, dy) / core)
      const v = peak * Math.min(1, horiz + vert + hot)
      if (v < 2) continue
      const i = base + Y * W + X
      const s = buf[i] + v
      buf[i] = s > 255 ? 255 : s
    }
  }
}

export interface ShatterMaps {
  /** 每帧的 x 坐标表，gray16le，按帧顺序拼接 */
  xmap: Buffer
  ymap: Buffer
  /** 逐片过曝遮罩，gray8：255=全白，0=原色。见 BLOOM_SPAN */
  bloom: Buffer
  /** 棱光遮罩，gray8：碎片断口的高光 + 翻面反光 + 星芒。见 RIM_PX */
  spec: Buffer
  frames: number
}

/**
 * 过曝在各碎片**自己**飞行进度的这个比例内消退。
 *
 * 参考视频里飞行中的碎片几乎是纯白剪影，已落位的却是正常色彩，**两者同屏共存**——
 * 所以过曝必须是逐片的，不能是全局包络。遮罩把「这个像素属于哪片、那片飞到哪了」
 * 一并烘进去，渲染时一次 maskedmerge 就还原出这个效果。
 */
const BLOOM_SPAN = 0.72
/** 峰值不给满 255：留一点原图，碎片才有形状而不是一团白 */
const BLOOM_PEAK = 236

// ── 玻璃感从哪来 ──
//
// 放大参考视频看，玻璃的辨识特征**不在碎片本身，在断口**：每条裂缝两侧各有一条
// 明亮的白色棱边，还带粉/蓝的色散镶边。只把缝隙留黑（第一版）像撕纸，不像碎玻璃。
//
// 所以再烘一张「棱光」遮罩，三样东西叠在一起：
//   1. 断口棱边 —— 距碎片边界 RIM_PX 内的像素提亮，模拟断面折射的那道光
//   2. 翻面反光 —— 碎片翻转到某个角度时整片一闪，就是"闪光特效"
//   3. 星芒 —— 反光最强的瞬间在碎片中心炸一个四角星
/** 棱边宽度（像素，按 720×960 标定，随画布缩放）。
 * 硬边收窄、扩散光放宽 = 「淡淡的发光」；反过来会变成一条实心亮线，像描边不像玻璃。 */
const RIM_PX = 9
const RIM_PEAK = 205
/** 棱光在飞行最后这一段淡出；必须在落位那一刻归零，否则成片上会留一张发光的网格 */
const RIM_FADE = 0.18
/**
 * 翻面反光：每片碎片在**自己的时刻**闪一次。
 *
 * 第一版把反光算成翻转角的 `cos^14`，结果是错的：翻转角在落位时收敛到 0，
 * `cos(0)=1` ⇒ **每片落位那一刻都被打满反光**，48 张脸同时提亮成一片灰，
 * 暗色原图整个被吃掉。反光是"转过某个角度时一闪而过"，不是"停下来最亮"。
 *
 * 改成按各自飞行进度上的一个窄峰：峰位逐片错开，落位时必然为 0。
 */
const FLASH_WIDTH = 0.11
const FLASH_PEAK = 205
/** 星芒：反光超过这个强度才炸，避免满屏都是星 */
const STAR_TRIGGER = 0.62
const STAR_PEAK = 235

/** 超出画面的坐标：remap 会用 fill 色填它，也就是碎片之间的黑缝 */
const OUT_OF_RANGE = 65535

/**
 * 生成整段开场的坐标表。
 *
 * 逆映射：对每个输出像素反推它来自源图哪里。
 * 先撤平移、再撤非等比缩放（模拟 3D 翻转）、再撤旋转，落回源图坐标；
 * 若该点不在这片碎片的原始多边形内，说明这个像素不属于它。
 *
 * 只遍历每片的**变换后包围盒**，不是全画面 —— 否则 65 帧 × 48 片 × 69 万像素
 * 要跑 21 亿次判断。
 */
export function buildShatterMaps(g: ShatterGeom): ShatterMaps {
  const { width: W, height: H } = g
  const { shards, label, edgeDist } = buildGeometry(g)
  const frames = Math.max(1, Math.round((g.durationMs / 1000) * g.fps))
  const px = W * H
  const xmap = Buffer.alloc(px * 2 * frames)
  const ymap = Buffer.alloc(px * 2 * frames)
  const bloom = Buffer.alloc(px * frames) // gray8，0 初始 = 不过曝
  const spec = Buffer.alloc(px * frames) // gray8，0 初始 = 无棱光
  // 棱边宽度与星芒半径按画布缩放，理由同飞入距离：写死像素换尺寸就跑偏
  const scale = Math.hypot(W, H) / 1200
  const rimPx = RIM_PX * scale
  const starR = 130 * scale

  for (let f = 0; f < frames; f++) {
    const base = f * px * 2
    const bbase = f * px
    // 该帧先全部填成越界（= 黑），再由各片覆盖自己的区域
    for (let i = 0; i < px; i++) {
      xmap.writeUInt16LE(OUT_OF_RANGE, base + i * 2)
      ymap.writeUInt16LE(OUT_OF_RANGE, base + i * 2)
    }
    const t = frames === 1 ? 1 : f / (frames - 1)

    for (let si = 0; si < shards.length; si++) {
      const s = shards[si]
      const pose = shardPoseAt(s, t)
      const { dx, dy, ang, sx, sy, progress: p } = pose
      if (p <= 0) continue // 还没起飞：保持越界 → 黑
      const ca = Math.cos(-ang)
      const sa = Math.sin(-ang)
      // 指数 <1：过曝先稳在高位、临落位才快速收干净，与参考视频的节奏一致
      const bl = p >= BLOOM_SPAN ? 0 : Math.round(BLOOM_PEAK * Math.pow(1 - p / BLOOM_SPAN, 0.55))

      // 棱光：飞行全程都在，只在最后 RIM_FADE 那一段淡出。
      // 参考视频里碎片快拼合时断口仍然很亮，是它撑住了"玻璃"这个观感。
      const rimEnv = Math.min(1, (1 - p) / RIM_FADE)
      // 翻面反光：以本片的 flashAt 为中心的窄峰，落位（p=1）时必然衰减到 0
      const fd = (p - s.flashAt) / FLASH_WIDTH
      const flash = Math.exp(-fd * fd * 6)
      const faceLit = FLASH_PEAK * flash

      // 该片在输出画面上的扫描范围：把源图包围盒的四角正变换过去取极值。
      // 变换是仿射的，所以这样一定包住该片变换后的全部像素。
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const [qx, qy] of [[s.sx0, s.sy0], [s.sx1, s.sy0], [s.sx1, s.sy1], [s.sx0, s.sy1]]) {
        const { x: X, y: Y } = forwardPoint(s, pose, qx, qy)
        if (X < minX) minX = X
        if (X > maxX) maxX = X
        if (Y < minY) minY = Y
        if (Y > maxY) maxY = Y
      }
      const x0 = Math.max(0, Math.floor(minX))
      const x1 = Math.min(W - 1, Math.ceil(maxX))
      const y0 = Math.max(0, Math.floor(minY))
      const y1 = Math.min(H - 1, Math.ceil(maxY))
      if (x1 < x0 || y1 < y0) continue

      for (let Y = y0; Y <= y1; Y++) {
        for (let X = x0; X <= x1; X++) {
          // 逆变换：撤平移 → 撤旋转 → 撤缩放
          const ax = X - s.cx - dx
          const ay = Y - s.cy - dy
          const bx = ax * ca - ay * sa
          const by = ax * sa + ay * ca
          const u = Math.round(bx / sx + s.cx)
          const v = Math.round(by / sy + s.cy)
          if (u < 0 || u >= W || v < 0 || v >= H) continue
          const src = v * W + u
          // 归属直接查表：每个源像素恰好属于一块，不重不漏是构造保证的
          if (label[src] !== si) continue
          const idx = Y * W + X
          xmap.writeUInt16LE(u, base + idx * 2)
          ymap.writeUInt16LE(v, base + idx * 2)
          bloom[bbase + idx] = bl
          // 棱光：距裂缝越近越亮。距离在**源图坐标系**上量，
          // 这样碎片被压扁时棱边也跟着压扁，不会看出是后期贴上去的
          const d = edgeDist[src]
          let lit = faceLit
          if (d < rimPx) lit += RIM_PEAK * Math.pow(1 - d / rimPx, 1.7) * rimEnv
          if (lit > 2) spec[bbase + idx] = lit > 255 ? 255 : lit
        }
      }

      // 星芒：反光最强的那一瞬间在碎片当前位置炸一个
      if (flash > STAR_TRIGGER) {
        const c = forwardPoint(s, pose, s.cx, s.cy)
        drawStar(spec, bbase, W, H, c.x, c.y, starR, STAR_PEAK * flash)
      }
    }
  }
  return { xmap, ymap, bloom, spec, frames }
}

/** 光晕的扩散半径与叠加强度 */
const GLOW_SIGMA = 22
const GLOW_OPACITY = 0.55
/** 棱光的硬边强度，以及它那层扩散光的半径与强度 */
const SPEC_OPACITY = 0.62
const SPEC_GLOW_SIGMA = 11
const SPEC_GLOW_OPACITY = 0.6

export interface ShatterRenderOpts {
  /** 开场底图（本条片子自己的图） */
  imgAbs: string
  width: number
  height: number
  fps: number
  durationMs: number
  /** 四张预渲染映射表（ffv1 无损，见 renderPipeline.ensureShatterMaps） */
  xmapAbs: string
  ymapAbs: string
  bloomAbs: string
  specAbs: string
  outAbs: string
}

/**
 * 开场碎裂片段的完整 ffmpeg 参数。
 *
 * 产出契约与原先那条浏览器渲的一致（同尺寸、同时长、无声的 mp4），
 * 所以下游 renderFull 一行都不用改。
 */
export function buildShatterArgs(o: ShatterRenderOpts): string[] {
  const { width: W, height: H } = o
  const frames = Math.max(1, Math.round((o.durationMs / 1000) * o.fps))
  // 底图按 cover 铺满：与正片一致，留白是之前修过的老毛病
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`
  const filter = [
    `[0:v]${fit},format=gbrp[img]`,
    `[img][1:v][2:v]remap=fill=black,format=gbrp[sh]`,
    // 白层：过曝要混向的目标色
    `color=c=white:s=${W}x${H}:r=${o.fps},format=gbrp[wh]`,
    `[3:v]format=gbrp,split[mk][mk2]`,
    // 光晕由过曝遮罩派生：只有还在飞的碎片发光，全部落位后遮罩归零、光晕自动消失，
    // 不需要用时间开关去卡窗口（卡窗口一定会在切换那一帧闪一下）。
    // 顺带把 R/B 反向错开几像素，遮罩的渐变边缘就成了参考视频里那种彩色镶边。
    `[mk2]gblur=sigma=${GLOW_SIGMA}:steps=2,rgbashift=rh=-5:bh=5:rv=-3:bv=3[glow]`,
    // 棱光：断口高光 + 翻面反光 + 星芒。
    // R/B 反向错开做色散镶边——参考视频里棱边一侧偏粉、另一侧偏蓝，
    // 那正是"玻璃"而非"撕纸"的判别特征。错开量比光晕小，棱边本身很细。
    `[4:v]format=gbrp,rgbashift=rh=-2:bh=2:rv=-1:bv=1[spec]`,
    // 棱光再糊一层很小的模糊后叠回去：断面折射的光是有一点扩散的，
    // 纯硬边看着像描线。两份都要，硬边给形、软边给光。
    `[spec]split[sp1][sp2]`,
    `[sp2]gblur=sigma=${SPEC_GLOW_SIGMA}:steps=1[spglow]`,
    // 遮罩 0 → 取原碎片色，255 → 取白，中间线性混合 = 逐片过曝
    `[sh][wh][mk]maskedmerge[merged]`,
    `[merged][glow]blend=all_mode=screen:all_opacity=${GLOW_OPACITY}[g1]`,
    `[g1][sp1]blend=all_mode=screen:all_opacity=${SPEC_OPACITY}[g2]`,
    `[g2][spglow]blend=all_mode=screen:all_opacity=${SPEC_GLOW_OPACITY},format=yuv420p[v]`,
  ].join(';')
  return [
    '-v', 'error',
    '-loop', '1', '-framerate', String(o.fps), '-i', o.imgAbs,
    '-i', o.xmapAbs,
    '-i', o.ymapAbs,
    '-i', o.bloomAbs,
    '-i', o.specAbs,
    '-filter_complex', filter,
    '-map', '[v]',
    '-frames:v', String(frames),
    '-r', String(o.fps),
    // 无损中间件：这段还要和正片一起再编一次，先编两遍会把碎片边缘啃花
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-an',
    '-y', o.outAbs,
  ]
}
