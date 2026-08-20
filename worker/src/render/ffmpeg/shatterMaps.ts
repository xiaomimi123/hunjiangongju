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
  /** 碎片格网 */
  cols: number
  rows: number
}

export const DEFAULT_GEOM = { cols: 6, rows: 8 } as const

/**
 * 映射表格式/内容的版本号，进缓存键。
 *
 * 缓存键原先只含画布尺寸与时长。那样改了生成算法而键不变，服务器上会继续吃旧缓存——
 * 表现是「部署完了画面却没变」，而且查不到任何报错。**改动本文件里任何影响
 * 映射表数值的常量或算法，都要把这个号 +1。**
 */
export const SHATTER_MAPS_VERSION = 2

/** 碎片在整段时长的这个比例处合拢；之后留一点静置，避免刚落位就切场景 */
const ASSEMBLE_AT = 0.78
/** 每批起飞的间隔（占总时长比例）与批数 —— 决定「前几帧几乎全黑、之后越来越密」 */
const STAGGER = 0.055
const BATCHES = 6
/** 压缩下限：完全侧棱(cos=0)会让碎片消失成一条线，留一点厚度 */
const MIN_SQUASH = 0.12

export interface Shard {
  poly: { x: number; y: number }[]
  cx: number
  cy: number
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
 * 顶点格网 + 逐片参数。
 *
 * 相邻单元**共用顶点**，所以碎片落位后能严丝合缝铺满画面（这是 CSS 版第一次做错的地方：
 * 每片各自向内裁，拼合后满屏黑缝）。所有随机量都由下标经三角函数派生——
 * 本仓禁用 Math.random，且随机会让同一模板每次渲染都不同、出问题无法复现。
 */
export function buildShards(g: ShatterGeom): Shard[] {
  const cw = g.width / g.cols
  const ch = g.height / g.rows
  const pts: { x: number; y: number }[][] = []
  for (let r = 0; r <= g.rows; r++) {
    const row: { x: number; y: number }[] = []
    for (let c = 0; c <= g.cols; c++) {
      const edge = r === 0 || c === 0 || r === g.rows || c === g.cols
      const jx = edge ? 0 : Math.sin(r * 3.1 + c * 1.7) * cw * 0.3
      const jy = edge ? 0 : Math.cos(r * 2.3 + c * 2.9) * ch * 0.3
      row.push({ x: c * cw + jx, y: r * ch + jy })
    }
    pts.push(row)
  }

  // 飞入距离按**画布对角线**取比例，不能写死像素：写死的话换个画布尺寸，
  // 碎片可能全程都在画面外（小画布）或起手就贴着边（大画布），效果整个跑偏。
  // 系数按 720×960（对角线 1200）标定，那个尺寸下与标定时的数值完全一致。
  const diag = Math.hypot(g.width, g.height)
  const out: Shard[] = []
  let i = 0
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const poly = [pts[r][c], pts[r][c + 1], pts[r + 1][c + 1], pts[r + 1][c]]
      const cx = (poly[0].x + poly[1].x + poly[2].x + poly[3].x) / 4
      const cy = (poly[0].y + poly[1].y + poly[2].y + poly[3].y) / 4
      // 飞入方向按黄金角绕圈，保证四面八方都有来路
      const ang = (i * 137.5 * Math.PI) / 180
      const dist = diag * (0.4333 + ((i * 53) % 320) / 1200)
      out.push({
        poly, cx, cy,
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist - diag * 0.075,
        rot: (Math.sin(i * 1.31) * 120 * Math.PI) / 180,
        rx: (Math.cos(i * 0.97) * 84 * Math.PI) / 180,
        ry: (Math.sin(i * 1.63) * 84 * Math.PI) / 180,
        startT: STAGGER * (i % BATCHES),
        // 峰位逐片错开铺在 0.16~0.62，且都远离落位点，落位时反光必为 0
        flashAt: 0.16 + ((i * 37) % 100) / 100 * 0.46,
      })
      i++
    }
  }
  return out
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
 * 点是否在四边形内 —— 射线法。
 *
 * 不能用「叉积同号」那种凸多边形判定：顶点抖动会让个别单元变成**凹**四边形
 * （实测 48 片里有 1 片），凹角那一侧会被判成外部，而相邻碎片也不认领它，
 * 于是落位后画面上留下一条黑线。射线法对任意简单多边形都成立。
 */
function inQuad(px: number, py: number, q: { x: number; y: number }[]): boolean {
  let inside = false
  for (let k = 0, j = 3; k < 4; j = k++) {
    const a = q[k]
    const b = q[j]
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * 把多边形绕形心外扩一点点。
 *
 * 相邻碎片共用边，射线法在边上只判给其中一侧——遇到取整误差就可能**两侧都不认领**，
 * 留下 1px 黑缝。外扩让两侧略微重叠：重叠处后画的盖住先画的，源坐标只差不到 1px，
 * 肉眼不可见；而「没人认领」是可见的。宁可重叠，不可留缝。
 */
const EXPAND_PX = 0.6
function expandPoly(poly: { x: number; y: number }[], cx: number, cy: number) {
  return poly.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1
    return { x: p.x + ((p.x - cx) / d) * EXPAND_PX, y: p.y + ((p.y - cy) / d) * EXPAND_PX }
  })
}

/** 点到线段的距离平方。棱边宽度判定用得上，先比较平方值可以省掉大部分开方。 */
function distSqToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = px - (ax + t * vx)
  const dy = py - (ay + t * vy)
  return dx * dx + dy * dy
}

/** 点到四边形边界的最短距离 */
function distToEdge(px: number, py: number, q: { x: number; y: number }[]): number {
  let m = Infinity
  for (let k = 0; k < 4; k++) {
    const a = q[k]
    const b = q[(k + 1) % 4]
    const d = distSqToSeg(px, py, a.x, a.y, b.x, b.y)
    if (d < m) m = d
  }
  return Math.sqrt(m)
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
/** 棱边宽度（像素，按 720×960 标定，随画布缩放） */
const RIM_PX = 7
const RIM_PEAK = 250
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
  const shards = buildShards(g)
  // 认领范围用外扩后的多边形（只算一次）；源坐标仍取自原图，外扩只影响"谁认领这个像素"
  const hit = shards.map((s) => expandPoly(s.poly, s.cx, s.cy))
  const frames = Math.max(1, Math.round((g.durationMs / 1000) * g.fps))
  const px = g.width * g.height
  const xmap = Buffer.alloc(px * 2 * frames)
  const ymap = Buffer.alloc(px * 2 * frames)
  const bloom = Buffer.alloc(px * frames) // gray8，0 初始 = 不过曝
  const spec = Buffer.alloc(px * frames) // gray8，0 初始 = 无棱光
  // 棱边宽度与星芒半径按画布缩放，理由同飞入距离：写死像素换尺寸就跑偏
  const scale = Math.hypot(g.width, g.height) / 1200
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
      const quad = hit[si]
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

      // 变换后包围盒：把四个顶点正变换过去取极值
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const q of quad) {
        const { x: X, y: Y } = forwardPoint(s, pose, q.x, q.y)
        if (X < minX) minX = X
        if (X > maxX) maxX = X
        if (Y < minY) minY = Y
        if (Y > maxY) maxY = Y
      }
      const x0 = Math.max(0, Math.floor(minX))
      const x1 = Math.min(g.width - 1, Math.ceil(maxX))
      const y0 = Math.max(0, Math.floor(minY))
      const y1 = Math.min(g.height - 1, Math.ceil(maxY))
      if (x1 < x0 || y1 < y0) continue

      for (let Y = y0; Y <= y1; Y++) {
        for (let X = x0; X <= x1; X++) {
          // 逆变换：撤平移 → 撤旋转 → 撤缩放
          const ax = X - s.cx - dx
          const ay = Y - s.cy - dy
          const bx = ax * ca - ay * sa
          const by = ax * sa + ay * ca
          const u = bx / sx + s.cx
          const v = by / sy + s.cy
          if (u < 0 || u >= g.width || v < 0 || v >= g.height) continue
          if (!inQuad(u, v, quad)) continue
          const idx = Y * g.width + X
          xmap.writeUInt16LE(Math.round(u), base + idx * 2)
          ymap.writeUInt16LE(Math.round(v), base + idx * 2)
          bloom[bbase + idx] = bl
          // 棱光：距断口越近越亮。距离在**源图坐标系**上量，
          // 这样碎片被压扁时棱边也跟着压扁，不会看出是后期贴上去的
          const d = distToEdge(u, v, quad)
          let lit = faceLit
          if (d < rimPx) lit += RIM_PEAK * Math.pow(1 - d / rimPx, 1.7) * rimEnv
          if (lit > 2) spec[bbase + idx] = lit > 255 ? 255 : lit
        }
      }

      // 星芒：反光最强的那一瞬间在碎片当前位置炸一个
      if (flash > STAR_TRIGGER) {
        const c = forwardPoint(s, pose, s.cx, s.cy)
        drawStar(spec, bbase, g.width, g.height, c.x, c.y, starR, STAR_PEAK * flash)
      }
    }
  }
  return { xmap, ymap, bloom, spec, frames }
}

/** 光晕的扩散半径与叠加强度 */
const GLOW_SIGMA = 22
const GLOW_OPACITY = 0.55
/** 棱光的硬边强度，以及它那层扩散光的半径与强度 */
const SPEC_OPACITY = 0.95
const SPEC_GLOW_SIGMA = 6
const SPEC_GLOW_OPACITY = 0.45

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
    `[4:v]format=gbrp,rgbashift=rh=-3:bh=3:rv=-1:bv=1[spec]`,
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
