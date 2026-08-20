// 「破镜重圆」开场：玻璃碎片带着强光从画外飞入、翻转、聚拢成完整画面。
//
// 对照客户参考视频（1080×1920、2.1 秒）逐帧拆出的六个特征，前四个是原实现完全没有的：
//   1. 碎片是不规则多边形，不是矩形网格
//   2. 每片带着最终画面的对应局部（碎块里能看到脸的一部分）
//   3. 强烈过曝高光 + 柔和光晕
//   4. 边缘彩色色散（红橙/蓝青分离）
//   5. 中途一次爆闪，整屏几乎全白
//   6. 从画外汇聚进来并落位，不是从散开位置滑到位
//
// 全部 tween 用字面量值（seek-safe：hyperframes 逐帧 seek 时间轴截图，函数式取值会失真）。
// 形状与飞入方向用固定三角函数按下标派生——不用 Math.random（本仓硬约束，且随机会让
// 同一模板每次渲染都不同，无法复现问题）。

import { esc, sec } from './util.js'

// 碎片格网。第一版用 4×3=12 片，实测碎片过大、更像「几块板子」而非玻璃碴；
// 参考视频里同时可见的碎片在 40~60 量级。每片是一个整画布尺寸的 div，
// 48 层在无头 Chromium 上实测可接受（开场只有 2 秒左右）。
const COLS = 6
const ROWS = 8
const SHARD_COUNT = COLS * ROWS

// 顶点格网：(COLS+1)×(ROWS+1) 个顶点，每个做确定性抖动。**相邻单元共用顶点**，
// 因此切出来的四边形能严丝合缝铺满画面——这是第一版失败的原因：当时每片在自己单元里
// 各自向内裁，相邻切边不重合，拼合后满屏黑缝。
//
// 抖动幅度按单元尺寸的比例给，边界顶点不抖（否则画面四周会露黑边）。
function lattice(cols: number, rows: number, w: number, h: number): { x: number; y: number }[][] {
  const cw = w / cols
  const ch = h / rows
  const pts: { x: number; y: number }[][] = []
  for (let r = 0; r <= rows; r++) {
    const row: { x: number; y: number }[] = []
    for (let c = 0; c <= cols; c++) {
      const edge = r === 0 || c === 0 || r === rows || c === cols
      // 固定相位派生，不用 Math.random：随机会让同一模板每次渲染都不同，出问题无法复现
      const jx = edge ? 0 : Math.sin(r * 3.1 + c * 1.7) * cw * 0.3
      const jy = edge ? 0 : Math.cos(r * 2.3 + c * 2.9) * ch * 0.3
      row.push({ x: c * cw + jx, y: r * ch + jy })
    }
    pts.push(row)
  }
  return pts
}

export interface ShatterOpts {
  containerClass: string
  imgSrc: string
  width: number
  height: number
}

export function shatterAssembleHtml(o: ShatterOpts): string {
  const { containerClass, imgSrc, width, height } = o
  const pts = lattice(COLS, ROWS, width, height)
  const parts: string[] = []
  let i = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const q = [pts[r][c], pts[r][c + 1], pts[r + 1][c + 1], pts[r + 1][c]]
      // 该片的包围盒 = 整块画布，用整幅贴图 + 全画布定位，靠 clip-path 切出自己的四边形。
      // 这样相邻片共用顶点、边界完全重合，不会有缝；代价是每片都是一个满屏图层。
      const poly = q.map((p) => `${Math.round(p.x * 100) / 100}px ${Math.round(p.y * 100) / 100}px`).join(',')
      // transform-origin 设在本片形心，翻转与缩放才像「这块玻璃在自转」，
      // 而不是整幅画在绕画布中心转（用画布中心会让边角片划出巨大弧线）。
      const cx = Math.round((q[0].x + q[1].x + q[2].x + q[3].x) / 4)
      const cy = Math.round((q[0].y + q[1].y + q[2].y + q[3].y) / 4)
      parts.push(
        `      <div class="sa-shard sa${i + 1}" style="width:${width}px;height:${height}px;` +
          `clip-path:polygon(${poly});transform-origin:${cx}px ${cy}px;` +
          `background-image:url('${esc(imgSrc)}');background-size:${width}px ${height}px;background-position:0 0;"></div>`,
      )
      i++
    }
  }
  return (
    `    <div class="${esc(containerClass)}" data-layout-ignore>\n` +
    parts.join('\n') +
    `\n      <div class="sa-flash"></div>\n` +
    `    </div>`
  )
}

/** 样式：过曝、光晕、色散都在这里；碎片本身只负责形状与贴图 */
export function shatterAssembleCss(): string {
  return [
    '.shatter-assemble{position:absolute;inset:0;overflow:hidden;background:#000;z-index:14;perspective:900px;}',
    '.sa-shard{position:absolute;left:0;top:0;will-change:transform,opacity,filter;backface-visibility:hidden;opacity:0;}',
    '.sa-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;}',
  ].join('\n')
}

/**
 * 时间轴。`durationMs` 是开场段总时长——碎片在前 78% 完成聚拢，末尾留一点静置，
 * 避免刚落位就切场景显得仓促。
 */
export function shatterAssembleTweens(durationMs: number): string {
  const total = Math.max(0.4, durationMs / 1000)
  const assembleEnd = Math.round(total * 0.78 * 1000) / 1000
  const lines: string[] = []
  const r3 = (x: number) => Math.round(x * 1000) / 1000

  for (let i = 0; i < SHARD_COUNT; i++) {
    const n = i + 1
    // 飞入方向：黄金角绕圈，保证四面八方都有来路且完全可复现
    const ang = (i * 137.5 * Math.PI) / 180
    const dist = 520 + ((i * 53) % 320)
    const dx = Math.round(Math.cos(ang) * dist)
    const dy = Math.round(Math.sin(ang) * dist) - 90
    const rot = Math.round(Math.sin(i * 1.31) * 120)
    // 接近 90° 时碎片看上去是「侧着的细长玻璃片」，这是参考视频最显著的形态特征；
    // 65° 只是斜着的方块，缺少那种薄片感。
    const rx = Math.round(Math.cos(i * 0.97) * 84)
    const ry = Math.round(Math.sin(i * 1.63) * 84)
    // 错峰起飞。参考视频前 0.3 秒画面几乎全黑、只有一两片细长亮片，
    // 之后才越来越密——所以要把先后差拉开到约 33% 总时长，而不是 20%。
    // 用 i%6 让同批起飞的碎片更少（48 片分 6 批，每批 8 片）。
    const at = r3(total * 0.055 * (i % 6))
    const dur = Math.max(0.12, r3(assembleEnd - at))
    lines.push(
      `  tl.fromTo('.sa${n}', ` +
        `{ opacity: 0, x: ${dx}, y: ${dy}, z: -260, rotation: ${rot}, rotationX: ${rx}, rotationY: ${ry} }, ` +
        `{ opacity: 1, x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, duration: ${dur}, ease: 'power3.out' }, ${at});`,
    )
    // 过曝 + 色散收敛。
    // 第一版用「整段飞行时长 + power2.in」，等于全程高亮到最后一刻才掉——实测中段整屏
    // 洗成灰白、看不出画面。改成 out 缓动、且只占飞行时长的 55%：起手爆亮、迅速回落，
    // 画面在落位前就已读得出内容。
    // 参考视频里碎片**整个飞入过程都是近乎全白的**，直到快落位才显出画面。
    // 0.55 太短，一半路程就已经能看清内容了，少了那种「光爆里飞过来」的劲。
    const bloomDur = Math.max(0.12, r3(dur * 0.72))
    lines.push(
      `  tl.fromTo('.sa${n}', ` +
        `{ filter: 'brightness(4.2) saturate(0.22) drop-shadow(0 0 34px rgba(255,255,255,0.95)) drop-shadow(-11px 0 rgba(255,50,20,0.95)) drop-shadow(11px 0 rgba(30,150,255,0.95))' }, ` +
        `{ filter: 'brightness(1) saturate(1) drop-shadow(0 0 0px rgba(255,255,255,0)) drop-shadow(0px 0 rgba(255,60,30,0)) drop-shadow(0px 0 rgba(40,160,255,0))', ` +
        `duration: ${bloomDur}, ease: 'power2.out' }, ${at});`,
    )
  }

  // 爆闪：碎片最密集的时刻整屏过曝，再迅速退掉。
  // 峰值几经下调：0.92 时 30fps 下有 3 帧近纯白，观感是「掉帧」不是「闪光」；0.7 仍与碎片
  // 自身的过曝叠加成一整片灰白板。0.55 + 更短的退场，既有闪、又始终看得见碎片。
  const flashAt = r3(total * 0.44)
  lines.push(`  tl.to('.sa-flash', { opacity: 0.75, duration: 0.06, ease: 'power2.out' }, ${flashAt});`)
  lines.push(`  tl.to('.sa-flash', { opacity: 0, duration: 0.2, ease: 'power2.in' }, ${r3(flashAt + 0.06)});`)
  // 收尾：整层淡出，交给正片
  lines.push(`  tl.to('.shatter-assemble', { opacity: 0, duration: 0.22, ease: 'sine.in' }, ${sec(durationMs) - 0.22});`)
  return lines.join('\n')
}
