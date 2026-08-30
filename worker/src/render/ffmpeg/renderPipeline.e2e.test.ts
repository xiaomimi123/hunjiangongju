// 接线层的真渲验收：喂一份真实形状的 BodyData，跑完「渲开场 → 备水波纹 → 总装」，
// 断言产出的 body.mp4 与 HyperFrames 分支同契约（720×960、无声、全片长）。
//
// 前面每个模块都单独验过了，但**接线本身没被验过**：hfDir 里的相对路径展开、
// 开场片段的时长与快闪起点对齐、水波纹缓存命中、ffmpeg 参数拼装——
// 这些只有把整条链真跑一遍才看得见。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, promises as fsp } from 'fs'
import os from 'os'
import path from 'path'
import { renderBodyWithFfmpeg } from './renderPipeline'
import { parseTemplateParams } from '../../../templates/booklist/templateParams'
import type { BodyData } from '../../../templates/booklist/bodyData'
import { minAdjacentChangedRatio, darkRatio } from './testkit'
import { subtitlesFilter } from './ass'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
const W = 720
const H = 960

function ff(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

d('真渲验收 —— FFmpeg 渲染管线接线', () => {
  let hfDir = ''
  let cacheRoot = ''
  let outAbs = ''

  const FLASH_END = 4000
  const B = (t: number) => FLASH_END + t

  const data = (): BodyData => ({
    size: { width: W, height: H },
    overlay: { title: '', subtitle: '', watermark: '@读书号' },
    images: [{ src: 'media/01.png' }, { src: 'media/02.png' }, { src: 'media/03.png' }],
    seed: 'task-e2e',
    template: 'flash',
    // 开场碎裂现在是纯 ffmpeg（坐标表 + remap），不再需要 Chromium，
    // 所以这里可以按真实模板打开它——接线连同碎裂一起验。
    templateParams: parseTemplateParams({
      mode: 'flash',
      open: { durationMs: 2159, shatter: true },
      transition: { type: 'dissolve', durationMs: 400, bodyCycle: [{ renderType: 'crossfade', durationMs: 500 }] },
      motion: { moves: [], keyframes: [{ scaleFrom: 1, scaleTo: 1.108 }] },
      effects: { ripple: { offsetMs: 7, durationMs: 458 } },
      // 标题字体选了非默认的内置字体：验收「运营在后台选的字体真正接通到渲染」
      // ——prepareFontsDir 必须收到这个 id，对应字体文件才会进 per-task fontsdir。
      text: { titleFontId: 'lxgw-wenkai' },
    }),
    flashCovers: [
      { title: '活着', author: '余华', coverSrc: 'covers/01.png' },
      { title: '兄弟', author: '余华', coverSrc: 'covers/02.png' },
    ],
    segments: [
      { seqNo: 1, startMs: 0, endMs: FLASH_END, subtitle: '今天分享的是', imageIndex: 0 },
      { seqNo: 2, startMs: B(0), endMs: B(4000), subtitle: '第一句', imageIndex: 1,
        bookTitle: '活着', bookAuthor: '余华',
        captionBeats: [{ zh: '如果你总困在过往的遗憾里', startMs: B(300), endMs: B(3700) }] },
      { seqNo: 3, startMs: B(4000), endMs: B(8000), subtitle: '第二句', imageIndex: 2,
        bookTitle: '活着', bookAuthor: '余华',
        captionBeats: [{ zh: '这本书会给你一个出口', startMs: B(4300), endMs: B(7700) }] },
    ],
  })

  beforeAll(async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mixcut-pipe-'))
    hfDir = path.join(root, 'hf')
    cacheRoot = path.join(root, 'cache')
    mkdirSync(path.join(hfDir, 'media'), { recursive: true })
    mkdirSync(path.join(hfDir, 'covers'), { recursive: true })
    // 亮度阶梯分明的素材：哪一段在播用亮度就判得出来
    const mk = (rel: string, b: number) => {
      const r = ff(['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${W * 2}x${H * 2}:rate=1:duration=1`,
        '-vf', `eq=brightness=${b}`, '-frames:v', '1', '-y', path.join(hfDir, rel)])
      if (!r.ok) throw new Error(`造图失败 ${rel}: ${r.out.slice(-300)}`)
    }
    mk('media/01.png', -0.1); mk('media/02.png', 0.0); mk('media/03.png', 0.25)
    mk('covers/01.png', -0.45); mk('covers/02.png', -0.4)
    outAbs = await renderBodyWithFfmpeg(hfDir, data(), cacheRoot)
  }, 180_000)

  afterAll(() => {
    if (hfDir) rmSync(path.dirname(hfDir), { recursive: true, force: true })
  })

  it('产出 720×960、无音轨（与 HyperFrames 分支同契约）', () => {
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', outAbs],
      { encoding: 'utf8' })
    expect(p.stdout).toContain('720,960')
    expect(p.stdout).not.toContain('audio')
  })

  // ★ 快闪 4s + 正片 8s = 12s，叠化**不再扣时长**。
  //
  // 原先每处 xfade 让总时长少掉一个转场的长度，而音频是各段配音直接拼接、
  // 字幕用的是未压缩的绝对时间 —— 视频比音频短，最后 -shortest 把尾巴上的旁白砍掉
  // （线上实测砍掉约 1 秒 = 两处 500ms 叠化，表现为「文案没读完就结束了」）。
  // 依据是剪映的转场本来就不吃时长：客户样例各段之和 24603ms、草稿声明 24592ms。
  it('总时长 = 快闪窗口 + 正片，叠化不扣时长', () => {
    const p = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', outAbs], { encoding: 'utf8' })
    expect(Math.abs(parseFloat(p.stdout) - 12.0)).toBeLessThan(0.2)
  })

  it('ASS 与 body.mp4 都落在 hf 目录里（后续步骤按约定路径取）', () => {
    expect(existsSync(path.join(hfDir, 'subs.ass'))).toBe(true)
    expect(outAbs).toBe(path.join(hfDir, 'renders', 'body.mp4'))
  })

  it('正片全程在动（运镜经过接线后仍生效）', () => {
    const m = minAdjacentChangedRatio(outAbs, [4.5, 6, 7.5, 9, 10.5])
    expect(m, `正片有时段定格: ${m}`).toBeGreaterThan(0.02)
  })

  // ★ 开场碎裂：碎片没飞到的地方是 remap 的 fill 黑，所以「开头近乎满屏黑、
  // 落位后回到素材自身的黑区水平」就是碎裂真的发生过的证据。
  //
  // 两个不能想当然的地方：
  //
  // 1. 不能断言「落位后几乎无黑」。实测落位后是 0.203，而那正是这套素材**自身**的
  //    黑区基线——关掉碎裂跑同一条链，全程恒为 0.203。把 0.203 当成"没拼合"是误判素材。
  // 2. 也不能断言「逐段单调收窄」。加了裂纹辉光之后实测 0.999→0.723→0.155→0.201：
  //    中段比落位后还低，因为辉光把暗像素提亮了。单调是旧版本才成立的巧合，不是性质。
  //
  // 真正的判别特征只有一条：**开头近乎全黑**。碎裂关掉时那一点是 0.203，一验就红。
  it('开场是碎裂拼合：黑区从近乎满屏收到素材基线', () => {
    const at = [0.1, 0.6, 1.2, 1.9].map((t) => darkRatio(outAbs, t))
    const shown = at.map((v) => v.toFixed(3)).join(' → ')
    expect(at[0], `开头不够黑(${shown})，碎片一上来就铺满了`).toBeGreaterThan(0.8)
    expect(at[1], `画面迟迟没被填进来(${shown})`).toBeLessThan(at[0] * 0.85)
    expect(at[3], `落位后黑区没收回基线(${shown})`).toBeLessThan(at[0] * 0.35)
  })

  // ★ 水波纹位移图按参数缓存：同模板的每条片子共用，不该逐条重渲 8 秒 geq
  it('水波纹位移图落在模板级缓存里，且带完成标记', async () => {
    const dir = path.join(cacheRoot, 'ripple', `${W}x${H}@30-458`)
    expect(existsSync(path.join(dir, '.done')), '缺完成标记，缓存下次会失效').toBe(true)
    const files = await fsp.readdir(dir)
    expect(files.filter((f) => f.startsWith('x')).length).toBeGreaterThan(10)
    expect(files.filter((f) => f.startsWith('y')).length).toBeGreaterThan(10)
  })

  // 碎裂坐标表同理按模板缓存：算一次约 2.5 秒，不该每条片子重算
  it('碎裂坐标表落在模板级缓存里，三张表俱全', async () => {
    const dir = path.join(cacheRoot, 'shatter', `v5-${W}x${H}@30-2159`)
    expect(existsSync(path.join(dir, '.done')), '缺完成标记，缓存下次会失效').toBe(true)
    for (const f of ['x.mkv', 'y.mkv', 'bloom.mkv']) {
      expect(existsSync(path.join(dir, f)), `缺 ${f}`).toBe(true)
    }
  })

  // ★ 运营在后台选的字体真正接通到渲染：prepareFontsDir 必须收到真实字体 id
  // （data() 里配了 titleFontId: 'lxgw-wenkai'），而不是恒传空数组。
  // 直接断言 prepareFontsDir 的入参不好做（它是模块内部函数，未导出），
  // 所以退一步断言产出的 per-task fontsdir 里确实有对应字体文件、且默认字体恒在。
  it('per-task fontsdir 里有选中的标题字体，且默认字体恒在', async () => {
    const dir = path.join(hfDir, 'fonts')
    const files = await fsp.readdir(dir)
    expect(files).toContain('LXGWWenKai-Regular.ttf')
    expect(files).toContain('NotoSansSC-Regular.otf')
  })

  it('缓存命中时不重渲（第二次调用不改动缓存目录的 mtime）', async () => {
    const marks = [
      path.join(cacheRoot, 'ripple', `${W}x${H}@30-458`, '.done'),
      path.join(cacheRoot, 'shatter', `v5-${W}x${H}@30-2159`, '.done'),
    ]
    const before = await Promise.all(marks.map(async (m) => (await fsp.stat(m)).mtimeMs))
    await renderBodyWithFfmpeg(hfDir, data(), cacheRoot)
    for (let i = 0; i < marks.length; i++) {
      expect((await fsp.stat(marks[i])).mtimeMs, `${marks[i]} 被重写了，说明没命中`).toBe(before[i])
    }
  }, 180_000)
})

// ★ 后台可选字体的全链路真渲验收（Task 17）。
//
// 前面两条已有的 e2e 各验了链路的一段，中间还留着一个从没被跑过的断点：
//   - ass.e2e.test.ts「分层字体真解析」：直接手工拼 AssStyleOpts.titleFontName 喂
//     给 buildAss，从没经过 templateParams 解析、fromBodyData 的族名映射——
//     如果某次重构把 titleFontId 从 BodyData 传到 fromBodyData 的路上漏传了，
//     这条测试完全看不见，因为它压根不走那条路。
//   - 上面这个文件里「per-task fontsdir 里有选中的标题字体」：只断言选中字体的
//     *文件*被拷进了 fontsdir，没断言 ffmpeg 真的解析到它——拷进去 ≠ 选对，
//     族名/字重算错了照样是"文件在、libass 视而不见"这种更隐蔽的静默失效。
//
// 这两段中间夹着的「运营在后台选的 titleFontId → parseTemplateParams 解析 →
// fromBodyData 查 BUILTIN_FONTS 换算族名 → prepareFontsDir 组装 fontsdir →
// buildAss 写 Fontname」整条链，此前没有任何测试从头跑到尾。断在中间任何一环，
// 现有测试全绿，成片却静默回退默认字体、渲染日志毫无异常。
//
// 做法：跑真实的 renderBodyWithFfmpeg（走完整条链），产出的 hfDir/subs.ass 与
// hfDir/fonts 是这条链**唯一的产物**——renderBodyWithFfmpeg 内部那次 ffmpeg
// 调用成功时不回传日志（renderPipeline.ts 的 run() 只在失败分支保留 stderr），
// 所以这里拿这两份产物单独喂一次 ffmpeg（传给 subtitlesFilter 的是与
// renderFull.ts 总装时逐字节相同的 assAbs/fontsDir），才能拿到 fontselect 日志、
// 证明真解析到了。
d('后台可选字体 —— 全链路真渲染验收（templateParams → fromBodyData 族名映射 → per-task fontsdir → ffmpeg 真解析）', () => {
  const CUE_ZH = '如果你总困在过往的遗憾里'

  // segments[0] 长度为 0（startMs=endMs=0）：flashTimeline 算出的 openEndMs
  // 因此恒为 0，fromBodyData 就不会挂"开场标题"(ot)层；不给 flashCovers 就不会
  // 有"快闪书封"(ft/fa)层；overlay.watermark 留空就不会有"水印"(wm)层。
  // 这样场景里就只剩 cap(正文字幕)/title(常驻书名) 两层——fontselect 命中谁、
  // 就能确定归因到谁，不会被"另一层本来就该是同一族名"混进来的巧合结果糊弄过去。
  function fontData(text: Record<string, unknown>): BodyData {
    return {
      size: { width: W, height: H },
      overlay: { title: '', subtitle: '', watermark: '' },
      images: [{ src: 'media/01.png' }],
      seed: 'task17-font',
      template: 'flash',
      templateParams: parseTemplateParams({ mode: 'flash', text }),
      segments: [
        { seqNo: 1, startMs: 0, endMs: 0, subtitle: '', imageIndex: 0 },
        {
          seqNo: 2, startMs: 0, endMs: 6000, subtitle: '', imageIndex: 0,
          bookTitle: '活着', bookAuthor: '余华',
          captionBeats: [{ zh: CUE_ZH, startMs: 300, endMs: 5700 }],
        },
      ],
    }
  }

  // 附加场景（captionFontBold 那条防静默链路）：不给 bookTitle，连 title 层都不出现——
  // title 层的 Bold 位是写死的 1，若这条也留着，fontsdir 里一旦真的有 Bold 文件，
  // title 层会一起被解析成 Bold，没法把结果单独归因到"cap 层的 captionFontBold 生效了"。
  function boldCapData(): BodyData {
    return {
      size: { width: W, height: H },
      overlay: { title: '', subtitle: '', watermark: '' },
      images: [{ src: 'media/01.png' }],
      seed: 'task17-font-bold',
      template: 'flash',
      templateParams: parseTemplateParams({ mode: 'flash', text: { captionFontId: 'noto-sc-bold' } }),
      segments: [
        { seqNo: 1, startMs: 0, endMs: 0, subtitle: '', imageIndex: 0 },
        { seqNo: 2, startMs: 0, endMs: 6000, subtitle: '', imageIndex: 0,
          captionBeats: [{ zh: CUE_ZH, startMs: 300, endMs: 5700 }] },
      ],
    }
  }

  let root = ''
  let cacheRoot = ''

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mixcut-pipe-font-'))
    cacheRoot = path.join(root, 'cache')
  })

  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }) })

  function allFontSelect(log: string): string {
    return log.match(/fontselect:[^\n]*/g)?.join('\n') ?? '(日志里没有 fontselect 行)'
  }

  /**
   * 单独跑一份 BodyData：建 hf 目录、放一张图、跑完整 renderBodyWithFfmpeg
   * （走 parseTemplateParams → fromBodyData → prepareFontsDir → buildRenderFullPlan
   * 全链路），再用它落盘的 subs.ass + fonts 目录单独喂一次 ffmpeg 拿 fontselect 日志。
   */
  async function renderAndCaptureLog(name: string, data: BodyData): Promise<string> {
    const hfDir = path.join(root, name)
    await fsp.mkdir(path.join(hfDir, 'media'), { recursive: true })
    const mkImg = ff(['-v', 'error', '-f', 'lavfi', '-i', `color=c=gray:s=${W}x${H}:r=30:d=1`,
      '-frames:v', '1', '-y', path.join(hfDir, 'media', '01.png')])
    if (!mkImg.ok) throw new Error(`造图失败: ${mkImg.out.slice(-300)}`)

    await renderBodyWithFfmpeg(hfDir, data, cacheRoot)

    const assAbs = path.join(hfDir, 'subs.ass')
    const fontsDir = path.join(hfDir, 'fonts')
    expect(existsSync(assAbs), 'renderBodyWithFfmpeg 没有落盘 subs.ass').toBe(true)
    expect(existsSync(fontsDir), 'renderBodyWithFfmpeg 没有落盘 per-task fontsdir').toBe(true)

    const probeOut = path.join(hfDir, 'probe.mp4')
    const r = ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=30:d=6`,
      '-vf', subtitlesFilter(assAbs, fontsDir), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-pix_fmt', 'yuv420p', probeOut])
    if (!r.ok) throw new Error(`用产物 subs.ass+fonts 探测字体解析失败: ${r.out.slice(-800)}`)
    return r.out
  }

  it(
    '标题字体全链路生效：titleFontId=noto-serif-sc 时 title 层解析到 NotoSerifSC，cap 层仍是 NotoSansSC（分层字体不是一刀切）',
    async () => {
      const log = await renderAndCaptureLog('serif', fontData({ titleFontId: 'noto-serif-sc' }))
      // 族名（Noto Serif SC）与文件内 PS 名（NotoSerifSC-Regular）两头都要对上——
      // 只查族名对不出"族名蒙对了、实际选到了别的文件"这种更隐蔽的错法。
      const titleResolved = /fontselect: \(Noto Serif SC,[^)]*\) -> [^\n]*NotoSerifSC/
      expect(log, `title 层没解析到思源宋体，fontselect 日志:\n${allFontSelect(log)}`).toMatch(titleResolved)
      // 正文字幕没配 captionFontId，必须仍是默认字体——证明 titleFontId 只影响了
      // title 层，没有把 fromBodyData 的 fontName（cap 层用）也一起带偏。
      const capResolved = /fontselect: \(Noto Sans SC,[^)]*\) -> [^\n]*NotoSansSC/
      expect(log, `cap 层字体被带偏了，fontselect 日志:\n${allFontSelect(log)}`).toMatch(capResolved)
      expect(log, `出现缺字回退(中文变豆腐块):\n${allFontSelect(log)}`).not.toMatch(/Glyph .* not found/i)
    },
    60_000,
  )

  it(
    '零回归：不配任何 *FontId 时全部走默认字体，日志里不出现 NotoSerifSC',
    async () => {
      const log = await renderAndCaptureLog('default', fontData({}))
      const resolved = /fontselect: \(Noto Sans SC,[^)]*\) -> [^\n]*NotoSansSC/
      expect(log, `没解析到默认字体，fontselect 日志:\n${allFontSelect(log)}`).toMatch(resolved)
      // 不是只看"有没有解析对"，还要看"有没有多出一个不该出现的族"——
      // 如果 titleFontId 缺省值被错误地解析成了某个非空 id（比如 parseTemplateParams
      // 的默认值兜底逻辑写反），这里会在日志里冒出 NotoSerifSC，而上一条断言依然会绿
      // （因为 cap 层本来就该是默认字体，测不出 title 层多选错了什么）。
      expect(log, `不该出现思源宋体，说明空 titleFontId 被当成了配置过:\n${allFontSelect(log)}`)
        .not.toMatch(/NotoSerifSC/)
      expect(log).not.toMatch(/Glyph .* not found/i)
    },
    60_000,
  )

  // 第三条：captionFontBold 那条防静默链路。noto-sc-bold 与 noto-sc 是同一个族名
  // （Noto Sans SC）、不同字重的两个真实文件——这正是 fonts.ts 注释里说的"同族名
  // 不同字重"场景。只查字符串里 Bold 位是不是 1 测不出来：族名相同时 libass 靠
  // (family, weight) 一起决定选哪个文件，字重传错也能在字符串层面看着"正确"。
  it(
    '正文字体选 noto-sc-bold 时，cap 层真的解析到 Bold 文件（不是只把 Bold 标志位写对，字重也传对了）',
    async () => {
      const log = await renderAndCaptureLog('bold', boldCapData())
      const boldResolved = /fontselect: \(Noto Sans SC,[^)]*\) -> [^\n]*NotoSansSC-Bold/
      expect(log, `cap 层没解析到 Bold 文件，fontselect 日志:\n${allFontSelect(log)}`).toMatch(boldResolved)
      expect(log).not.toMatch(/Glyph .* not found/i)
    },
    60_000,
  )
})
