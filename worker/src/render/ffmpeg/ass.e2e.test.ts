// ASS 文字层的真渲验收：真把字幕烧进画面，断言**像素上确实出现了字**、且只在该出现的时段出现。
//
// 单测只能证明 ASS 文件内容拼对了。字体解析不到（中文变豆腐块或整行空白）、
// PlayRes 没设导致字号缩水、时间码格式写错导致整段不显示——这些单测一个都看不见。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { buildAss, subtitlesFilter, type AssCue } from './ass'
import { FONTS_DIR, DEFAULT_FONT_NAME } from './fonts'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip

// 字体自带（见 fonts.ts）：本机与服务器用同一个文件，字体解析是确定性的。
// 此前这里依赖系统 fontconfig，本机解析不到 Noto CJK 会退到 Helvetica，
// 中文变豆腐块而墨迹断言照样绿——那条校验只能去服务器上做。现在本地就能验完。
const FONT = process.env.ASS_FONT ?? DEFAULT_FONT_NAME

const W = 720
const H = 960
/** 常驻书名所在的横条：STYLE 没给 titlePosY，走默认 0.22 → y≈211，56px 字上下各留些余量 */
const TITLE_BAND = `${W}:160:0:${Math.round(H * 0.22) - 80}`
const STYLE = {
  fontName: FONT, captionColor: '#ffffff', captionPosY: 0.78,
  captionSizePx: 48, titleSizePx: 56, titleColor: '#ffe9c0', watermarkSizePx: 22,
}

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * 某时刻某区域的「墨水占比」：亮度超过阈值的像素比例。
 * 底图用纯黑，字是白的——有字则占比明显大于 0，无字则恒为 0。
 * 比帧指纹更有信息量：能区分「画面变了」和「画面上真的多了字」。
 */
function inkRatio(mp4: string, atSec: number, crop: string): number {
  const r = spawnSync(FFMPEG,
    ['-v', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1',
      '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const buf = r.stdout as unknown as Buffer
  if (!buf || buf.length === 0) throw new Error('取区域像素失败')
  let ink = 0
  for (const v of buf) if (v > 96) ink++
  return ink / buf.length
}

d('真渲验收 —— ASS 文字层', () => {
  let dir = ''
  let out = ''
  let renderLog = ''
  // 字幕只在 2~4 秒出现；0~2 与 4~6 秒必须是干净的
  const CUES: AssCue[] = [{ text: '如果你总困在过往的遗憾', startMs: 2000, endMs: 4000 }]
  const CAP_BAND = `${W}:200:0:${Math.round(H * 0.78) - 160}`

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-ass-'))
    const assPath = path.join(dir, 's.ass')
    out = path.join(dir, 'o.mp4')
    writeFileSync(assPath, buildAss({
      width: W, height: H, totalMs: 6000, style: STYLE, captions: CUES,
      bookTitles: [{ text: '《简爱》', startMs: 0, endMs: 6000 }],
      watermark: '@读书号',
    }), 'utf8')
    const r = ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=30:d=6`,
      '-vf', subtitlesFilter(assPath, FONTS_DIR), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', out])
    if (!r.ok) throw new Error(`烧字幕失败: ${r.out.slice(-800)}`)
    renderLog = r.out
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  // ★ 字真的被画出来了。中文解析不到时这里会是 0（整行空白）。
  it('字幕时段内该区域出现墨迹', () => {
    const ink = inkRatio(out, 3, CAP_BAND)
    expect(ink, `字幕区域没有墨迹(字体解析失败或时间码错位)，ink=${ink}`).toBeGreaterThan(0.005)
  })

  // ★ 反证上一条有牙齿：同一区域、同一套测量，在无字幕时段必须是干净的。
  // 若这条也有墨迹，说明测的根本不是字幕（比如量到了别的图层）。
  it('字幕时段之外该区域干净（反证测量有效）', () => {
    expect(inkRatio(out, 0.8, CAP_BAND)).toBeLessThan(0.0005)
    expect(inkRatio(out, 5.2, CAP_BAND)).toBeLessThan(0.0005)
  })

  // band 要跟着 titlePosY 走：常驻书名画在 height*titlePosY（本例 ≈211）附近，
  // 不是贴着画面顶边。此前这里写死 20~180，标题位置调过之后就整条量空了——
  // 表现为一条**假红**（字明明在画面上，断言却说没有）。
  it('常驻书名在顶部全程可见', () => {
    const band = TITLE_BAND
    expect(inkRatio(out, 1, band)).toBeGreaterThan(0.003)
    expect(inkRatio(out, 5, band)).toBeGreaterThan(0.003)
  })

  // 字号缩水的典型症状是墨迹极少。PlayRes 没设时 libass 按 384x288 换算，
  // 48px 会被缩到约 14px —— 墨迹占比会掉一个量级。
  it('字号没有被 PlayRes 缩水', () => {
    // 48px 高、约 11 个汉字，在 720×200 的带里占比经验值 > 1.5%
    expect(inkRatio(out, 3, CAP_BAND)).toBeGreaterThan(0.015)
  })

  // ★ 常驻书名的「加粗」是真的加粗，不是样式行上那个没人执行的 Bold=1。
  //
  // 自带字体只有 Regular 字面，libass 不会给它合成假粗体——实测同一段文字
  // Bold=0 与 Bold=1 渲染出来**完全一致**，那个标志位一直是摆设。真加粗靠
  // ass.ts 里额外叠的那层同色描边（TITLE_BOLD_BORD）。
  //
  // 所以这条要在**像素上**比：把加粗层从 ASS 里删掉重渲一遍，同一条带的墨迹
  // 占比必须明显低于带加粗层的版本。只验字符串里有没有那行 Dialogue 是验不出
  // 「描边真的把笔画撑粗了」的——颜色写错、\bord 被后面的标签覆盖，字符串照样对。
  it('常驻书名有加粗层：去掉它之后同区域墨迹明显变少', () => {
    const plainAss = path.join(dir, 'plain.ass')
    const full = buildAss({
      width: W, height: H, totalMs: 6000, style: STYLE, captions: CUES,
      bookTitles: [{ text: '《简爱》', startMs: 0, endMs: 6000 }],
      watermark: '@读书号',
    })
    // 阈值 1.5 的来历：实测真加粗 = 1.96，而把 \bord 调成 0（等于没加粗、只是把
    // 同一个字形原地叠画一遍）仍有 1.14——叠画会把抗锯齿边缘变实，本身就抬一点墨迹。
    // 阈值必须落在这两者中间，贴着 1.14 设会让这条断言在退化实现下照样绿。
    // 只删 title 的加粗层。不能光按 `Dialogue: 1,` 过滤——**字幕层也在 Layer 1**，
    // 那样会把正文字幕一起删掉，对照组就不只差一个加粗层了。
    const stripped = full.split('\n').filter((l) => !/^Dialogue: 1,[^,]*,[^,]*,title,/.test(l)).join('\n')
    expect(stripped.split('\n').length, '没找到加粗层，过滤条件失效了').toBeLessThan(full.split('\n').length)
    writeFileSync(plainAss, stripped, 'utf8')

    const plainOut = path.join(dir, 'plain.mp4')
    const r = ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=30:d=6`,
      '-vf', subtitlesFilter(plainAss, FONTS_DIR), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', plainOut])
    if (!r.ok) throw new Error(`烧对照字幕失败: ${r.out.slice(-800)}`)

    const bold = inkRatio(out, 1, TITLE_BAND)
    const plain = inkRatio(plainOut, 1, TITLE_BAND)
    expect(bold / plain, `加粗层没把笔画撑粗: 带=${bold.toFixed(4)} 不带=${plain.toFixed(4)}`)
      .toBeGreaterThan(1.5)
  })

  // ★ 墨迹断言只能证明「画出了东西」，**证明不了画对了**：
  // 字体解析不到时 libass 会静默回退，中文可能变豆腐块，而墨迹断言照样绿。
  // 自带字体之后这条不再需要开关，任何环境都必须绿。
  it('请求的字体被真正解析到，且没有缺字回退（中文没变豆腐块）', () => {
    // 自带字体解析到的是**文件内的 PS 名** NotoSansSC-Regular
    const resolved = /fontselect: \(Noto Sans SC,[^)]*\) -> [^\n]*NotoSansSC/
    expect(renderLog, `字体被替换成了别的族: ${/fontselect:[^\n]*/.exec(renderLog)?.[0]}`).toMatch(resolved)
    expect(renderLog).not.toMatch(/Glyph .* not found/i)
  })
})

// 双语字幕：中文在上、英文紧贴其下，英文是**独立的** Dialogue 事件，靠 \an8+\pos
// 精确定位在中文基线下方（见 ass.ts buildAss 的双语分支；早前合并成一条事件的
// 方案因 e2e 实测中文行位移超标而被换掉，见任务报告）。
// 单测只能证明拼出来的文本里有 \pos/\fs/\c 覆盖标签——标签写没写生效、
// 英文字体解析得到还是回退成豆腐块、加了英文行之后中文会不会被顶飞，字符串测试一个都看不出来。
d('双语字幕真渲', () => {
  let dir = ''
  let onOut = ''
  let offOut = ''

  const STYLE_BI = {
    ...STYLE, captionPosY: 0.78, captionSizePx: 48,
    bilingual: true, enScale: 0.6, enColor: '#dddddd', enGapPx: 8,
  }
  const STYLE_OFF = { ...STYLE, captionPosY: 0.78, captionSizePx: 48 }
  const CUE: AssCue[] = [{ text: '这是一句中文字幕', en: 'This is one line of English', startMs: 200, endMs: 1800 }]

  // 中文基线 y ≈ H*0.78=749。中文行紧贴基线之上，双语开启时英文行接着往下长。
  // 带高留够两行字号(48px/29px)的余量，不贴着理论边界设——渲染字形有上下溢出。
  const zhBand = `${W}:70:0:${Math.round(H * 0.78) - 60}`
  const enBand = `${W}:60:0:${Math.round(H * 0.78) + 6}`

  function renderOnce(ass: string, outName: string): string {
    const assPath = path.join(dir, `${outName}.ass`)
    const outPath = path.join(dir, `${outName}.mp4`)
    writeFileSync(assPath, ass, 'utf8')
    const r = ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=30:d=2`,
      '-vf', subtitlesFilter(assPath, FONTS_DIR), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', outPath])
    if (!r.ok) throw new Error(`烧字幕失败(${outName}): ${r.out.slice(-800)}`)
    return outPath
  }

  /**
   * 在 [yFrom, yTo] 区间按 step 步长向下扫，找第一条「亮起来」的横条，近似定位
   * 文字块的上边缘。用来把「位置有没有变」从「面积有没有变」里剥离出来：
   * zhBand 那样的大面积带留了几十像素余量，小幅位移根本不会碰到边界、
   * 聚合墨迹占比纹丝不动——真要验位移必须直接量边缘在哪。
   */
  function findTopEdge(mp4: string, atSec: number, yFrom: number, yTo: number, step = 1, threshold = 0.01): number | null {
    for (let y = yFrom; y <= yTo; y += step) {
      if (inkRatio(mp4, atSec, `${W}:${step}:0:${y}`) > threshold) return y
    }
    return null
  }

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'mixcut-ass-bi-'))
    const onAss = buildAss({ width: W, height: H, captions: CUE, totalMs: 2000, style: STYLE_BI } as never)
    const offAss = buildAss({ width: W, height: H, captions: CUE, totalMs: 2000, style: STYLE_OFF } as never)
    onOut = renderOnce(onAss, 'on')
    offOut = renderOnce(offAss, 'off')
  })

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('中文行与英文行都真的有墨，且英文在中文下方', () => {
    // 阈值 0.002：实测中文带 ≈0.048、英文带 ≈0.023，都留了一个数量级以上的余量——
    // 不贴实测值，是为了在"英文只画出一部分字符/字号被进一步压缩"这类退化
    // (墨迹变少但没到 0)时仍然报错，而不是刚好卡在实测值附近变成测不出来。
    // 时段内两条带都要有墨——只测其中一条测不出「英文行整行空白」这种坏法
    // （中文字体是自带的稳字体，容易绿；\fs\c\fn 标签没生效导致英文渲染失败更容易漏）。
    expect(inkRatio(onOut, 1.0, zhBand), '中文带没墨').toBeGreaterThan(0.002)
    expect(inkRatio(onOut, 1.0, enBand), '英文带没墨(标签没生效或字体回退成空白)').toBeGreaterThan(0.002)
    // 反证：字幕开始前(0.05s，早于 startMs=200ms)两条带必须干净——
    // 否则说明量到的根本不是这条字幕，而是常驻的别的什么东西。
    expect(inkRatio(onOut, 0.05, zhBand), '字幕还没开始就有墨，测量对象不对').toBe(0)
    expect(inkRatio(onOut, 0.05, enBand), '字幕还没开始就有墨，测量对象不对').toBe(0)
  })

  it('关闭双语时英文带上完全没有墨', () => {
    // 反证上一条：开双语时英文带有墨不是巧合测量误差，因为关掉开关后同一条带
    // 在同一时刻必须绝对干净（不是「变少」，是 0）——这才说明那条带测的确实是英文行。
    expect(inkRatio(offOut, 1.0, enBand)).toBe(0)
  })

  it('★ 中文行位置与关闭双语时一致（顶边容差 ≤1px）', () => {
    // 为什么不直接比 zhBand 里的聚合墨迹占比：那条带比一行字高出几十像素的余量，
    // 中文行位移几像素，聚合占比根本不会变——这条断言会在位置真的错了的时候
    // 照样绿，等于没测。必须直接找中文行的上边缘在哪一行。
    //
    // 扫描窗口：实测关闭双语时中文行顶边在 baseline(749)-37≈712，字形实际占高
    // 比字号本身留的行盒矮不少(汉字字面比字号本身留白小)。窗口按实测结果两侧
    // 各留 30px 余量(679~739)，既不会因为太窄而找不到边缘，
    // 也不会宽到把上一行/别的东西也扫进来。
    //
    // ★ 容差从 6px 收紧到 1px：现在英文行是独立 Dialogue + \pos 定位，中文行的
    // Style/Dialogue 与关闭双语时逐字节相同（见 ass.test.ts 的静态断言），
    // 顶边理论上就该是 0 位移，1px 只是留给像素/编码的量化误差，不是给系数误差
    // 留的余量——如果这条不为 0，说明拆分方案本身有问题，不能靠调阈值糊过去。
    const baseline = Math.round(H * 0.78)
    const yFrom = baseline - 70
    const yTo = baseline - 10
    const topOff = findTopEdge(offOut, 1.0, yFrom, yTo)
    const topOn = findTopEdge(onOut, 1.0, yFrom, yTo)
    expect(topOff, `扫描窗口[${yFrom},${yTo}]里没找到关闭双语时的中文行顶边，窗口要调`).not.toBeNull()
    expect(topOn, `扫描窗口[${yFrom},${yTo}]里没找到开启双语时的中文行顶边，窗口要调`).not.toBeNull()
    expect(Math.abs((topOn as number) - (topOff as number)),
      `中文行顶边位移: 关闭=${topOff} 开启=${topOn}`).toBeLessThanOrEqual(1)
  })
})
