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

  it('常驻书名在顶部全程可见', () => {
    const band = `${W}:160:0:20`
    expect(inkRatio(out, 1, band)).toBeGreaterThan(0.003)
    expect(inkRatio(out, 5, band)).toBeGreaterThan(0.003)
  })

  // 字号缩水的典型症状是墨迹极少。PlayRes 没设时 libass 按 384x288 换算，
  // 48px 会被缩到约 14px —— 墨迹占比会掉一个量级。
  it('字号没有被 PlayRes 缩水', () => {
    // 48px 高、约 11 个汉字，在 720×200 的带里占比经验值 > 1.5%
    expect(inkRatio(out, 3, CAP_BAND)).toBeGreaterThan(0.015)
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
