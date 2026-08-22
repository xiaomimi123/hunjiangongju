// 真跑 TTS 流水线的验收 —— 字幕节拍与实际人声对齐。
//
// 为什么必须真跑整条 generateTts：这是第三个音画同步类 bug 了——
//   1. 补静音与字数配额不同源（错位一格）
//   2. 段时长用槽位对不上 bodyTimings
//   3. 字幕节拍摊在**变速前**的原始语音时长上（本次）：第 2 段 10272ms 被压到
//      8221ms，字幕却按 10272ms 排，尾部越过段边界压到下一段字幕头上——
//      线上实测两行字幕叠在画面上。
// 这类 bug 的共同点是「每个环节单看都对，串起来才错」，单测拦不住。
// TTS 网关 mock 成返回定长真 wav（时长可控），其余（ffmpeg 变速/拼接/探测、
// DB 读写、节拍计算）全部真跑。
//
// 跑法：RENDER_E2E=1 + DATABASE_URL（与其余 e2e 相同）。

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import path from 'path'

// ★ DATA_DIR 必须赶在任何 import 之前钉死——paths.ts 在模块加载时读环境变量。
// worker 的 tsconfig 是 CJS，不能用顶层 await 动态 import；vi.hoisted 会被提升到
// 所有 import 之前执行，正好补上这一步（回调里没有模块可用，只能用全局 process）。
const tmpData = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/mixcut-ttsdata-${process.pid}`
  process.env.DATA_DIR = dir
  return dir
})

// TTS 网关 mock：按文本长度返回定长真 wav（约 400ms/字，可预测超长）
const ttsMock = vi.hoisted(() => vi.fn())
vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return { ...actual, ttsSynthesize: (...args: unknown[]) => ttsMock(...args), enqueueGen: vi.fn(), setGenerationStatus: vi.fn() }
})

import { generateTts } from './generateTts'
import { prisma } from '@mixcut/db'

const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'
const d = process.env.RENDER_E2E === '1' ? describe : describe.skip
mkdirSync(tmpData, { recursive: true })

function makeWav(sec: number): Buffer {
  const f = path.join(tmpData, `tone-${sec.toFixed(2)}.wav`)
  const r = spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${sec.toFixed(3)}:sample_rate=48000`, '-ac', '1', '-y', f], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`造 wav 失败: ${r.stderr}`)
  return readFileSync(f)
}

d('真跑 TTS 流水线 —— 字幕节拍与实际人声对齐', () => {
  const frameworkIds: string[] = []
  const taskIds: string[] = []
  let taskId = ''

  beforeAll(async () => {
    // 每字约 400ms：第 2 段 24 字 → 9.6 秒，远超 8065ms 的槽位，必然触发变速
    ttsMock.mockImplementation((opts: { text: string }) =>
      Promise.resolve(makeWav(Math.max(0.5, Array.from(opts.text).length * 0.4))))

    const fw = await prisma.copyFramework.create({
      data: {
        frameworkText: 'T',
        overlayTemplate: {
          __templateParams: {
            mode: 'flash',
            open: { durationMs: 2159, titleText: '今天分享的是' },
            flash: { clipMs: [200, 200, 200] }, // 快闪窗口 600ms → 开场+快闪 2759ms
            body: { slotDurationsMs: [5703, 8065, 6068] },
          },
        } as never,
      },
    })
    frameworkIds.push(fw.id)
    const task = await prisma.generationTask.create({
      data: { subject: '活着', frameworkId: fw.id, status: 'TTS_GENERATING' },
    })
    taskIds.push(task.id)
    taskId = task.id

    const seg = (seqNo: number, beats: string[]) => ({
      generationTaskId: task.id, seqNo, scriptText: beats.join('，'),
      captionBeats: beats.map((zh) => ({ zh })) as never,
    })
    await prisma.generatedSegment.createMany({
      data: [
        seg(1, ['今天分享的是']),
        // 语音要明显短于槽位（书名 1.6s + 停顿 0.3s + 正文 2.4s + 留白 0.4s ≈ 4.7s < 5.703s）：
        // 若凑得贴近槽位会落进 6% 容差带——不变速也不补静音，段时长带着零头，
        // 那是设计内行为，但会让"精确落位"断言无谓地翻红
        seg(2, ['《活着》', '他把一生过成']),
        // 合成文本 23 字（含连接逗号）→ 9.2 秒，超出 8065ms 槽位 14%：
        // 落在 (6% 容差, 1.25× 上限] 区间内 → 必然触发变速、且能被精确压回槽位。
        // 再长会顶到变速上限压不回去（那是设计内的"画面变长"行为，另一码事）
        seg(3, ['别人晒加班到凌晨的朋友圈', '你只能把话咽下去慢慢']),
        seg(4, ['这本书会给你一个出口']),
      ],
    })

    await generateTts(task.id)
  }, 120_000)

  afterAll(async () => {
    await prisma.generatedSegment.deleteMany({ where: { generationTaskId: { in: taskIds } } })
    await prisma.generationTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
    await prisma.$disconnect()
    rmSync(tmpData, { recursive: true, force: true })
  })

  async function loadAll() {
    const t = await prisma.generationTask.findUniqueOrThrow({ where: { id: taskId } })
    const segs = await prisma.generatedSegment.findMany({ where: { generationTaskId: taskId }, orderBy: { seqNo: 'asc' } })
    const timings = t.bodyTimings as { seqNo: number; startMs: number; endMs: number }[]
    return { timings, segs }
  }

  // ★ 本次事故的直接回归：变速后的段，字幕不得越过段边界。
  // 旧代码按变速前的原始时长排节拍，第 3 段（触发 1.25× 变速）的尾拍
  // 会伸进第 4 段的时间窗，与那边的字幕同屏——两行叠在画面上。
  it('触发变速的段：字幕节拍不越过本段边界', async () => {
    const { timings, segs } = await loadAll()
    for (const seg of segs) {
      const win = timings.find((x) => x.seqNo === seg.seqNo)!
      const beats = seg.captionBeats as { zh: string; startMs: number; endMs: number }[]
      for (const b of beats) {
        expect(b.endMs, `段${seg.seqNo}「${b.zh}」endMs=${b.endMs} 越过段尾 ${win.endMs}`)
          .toBeLessThanOrEqual(win.endMs + 1)
        expect(b.startMs, `段${seg.seqNo}「${b.zh}」startMs=${b.startMs} 早于段头 ${win.startMs}`)
          .toBeGreaterThanOrEqual(win.startMs)
      }
    }
  })

  it('任意两拍字幕不重叠（同屏只有一条）', async () => {
    const { segs } = await loadAll()
    const all = segs.flatMap((s) => s.captionBeats as { zh: string; startMs: number; endMs: number }[])
      .sort((a, b) => a.startMs - b.startMs)
    for (let i = 1; i < all.length; i++) {
      expect(all[i].startMs, `「${all[i - 1].zh}」(至${all[i - 1].endMs}) 与「${all[i].zh}」(起${all[i].startMs}) 同屏`)
        .toBeGreaterThanOrEqual(all[i - 1].endMs)
    }
  })

  // 书名前留白：人声后移了 400ms，字幕必须跟着移，否则字幕抢先出现在静音里
  it('书名段的首拍字幕不早于留白结束', async () => {
    const { timings, segs } = await loadAll()
    const seg2 = segs.find((s) => s.seqNo === 2)!
    const win = timings.find((x) => x.seqNo === 2)!
    const beats = seg2.captionBeats as { startMs: number }[]
    expect(beats[0].startMs, '字幕抢在书名前留白里出现了').toBeGreaterThanOrEqual(win.startMs + 400)
  })

  it('段时长仍精确落在草稿槽位（回归）', async () => {
    const { timings } = await loadAll()
    const durs = timings.map((t) => t.endMs - t.startMs)
    expect(Math.abs(durs[0] - 2759), `开场+快闪 ${durs[0]}`).toBeLessThan(60)
    expect(Math.abs(durs[1] - 5703), `正片1 ${durs[1]}`).toBeLessThan(60)
    expect(Math.abs(durs[2] - 8065), `正片2（触发变速压回槽位）${durs[2]}`).toBeLessThan(60)
    expect(Math.abs(durs[3] - 6068), `正片3 ${durs[3]}`).toBeLessThan(60)
  })
})
