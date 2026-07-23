import path from 'path'
import { describe, it, expect } from 'vitest'
import { canonicalFullAudioPath, hasExactTimings } from './alignCaptions'
import { DATA_DIR } from '../paths'

describe('canonicalFullAudioPath（幂等性关键：alignCaptions 音频源路径）', () => {
  it('返回 DATA_DIR/gen/<genTaskId>/full_audio.wav，与 generateTts.ts 的写入路径约定一致', () => {
    const genTaskId = 'task-abc-123'
    expect(canonicalFullAudioPath(genTaskId)).toBe(
      path.join(DATA_DIR, 'gen', genTaskId, 'full_audio.wav'),
    )
  })

  it('只依赖 genTaskId，与 task.fullAudioUrl 的当前值无关 → 不会被 fullAudioUrl 的重写影响（幂等性核心）', () => {
    const genTaskId = 'task-xyz-789'
    // 第一次运行前：fullAudioUrl 指向原始文件
    const beforePace = canonicalFullAudioPath(genTaskId)
    // 模拟第一次运行末尾把 task.fullAudioUrl 重写为 full_audio_paced.wav 之后，
    // 若重跑 alignCaptions（worker 重启 / BullMQ 重跑），canonicalFullAudioPath
    // 的返回值必须与之前一致（不读取、不受 fullAudioUrl 影响），
    // 从而保证第二次运行仍从原始 full_audio.wav 取音，而非已被 pace 过的文件。
    const afterPace = canonicalFullAudioPath(genTaskId)
    expect(afterPace).toBe(beforePace)
    expect(afterPace).not.toContain('full_audio_paced.wav')
    expect(afterPace.endsWith('full_audio.wav')).toBe(true)
  })

  it('不同 genTaskId → 不同路径，互不干扰', () => {
    expect(canonicalFullAudioPath('a')).not.toBe(canonicalFullAudioPath('b'))
  })
})

describe('hasExactTimings（是否跳过 silencedetect 猜段）', () => {
  const timings = [{ seqNo: 0, startMs: 0, endMs: 3200 }]
  const exactSeg = { captionBeats: [{ zh: '一句', startMs: 0, endMs: 1500 }] }

  it('bodyTimings 已写 + 某段节拍带 startMs → true（走逐段配音的精确时长）', () => {
    expect(hasExactTimings(timings, [exactSeg])).toBe(true)
  })

  it('只要有一段带精确 startMs 即可 → true（其余段可能是单句无节拍）', () => {
    expect(hasExactTimings(timings, [{ captionBeats: [{ zh: '无时间' }] }, exactSeg])).toBe(true)
  })

  it('bodyTimings 缺失/空数组 → false（旧任务，仍需 silencedetect）', () => {
    expect(hasExactTimings(undefined, [exactSeg])).toBe(false)
    expect(hasExactTimings([], [exactSeg])).toBe(false)
    expect(hasExactTimings('not-an-array', [exactSeg])).toBe(false)
  })

  it('有 bodyTimings 但没有任何节拍带 startMs → false（均分兜底出来的时间，不算精确）', () => {
    expect(hasExactTimings(timings, [{ captionBeats: [{ zh: '一句' }] }])).toBe(false)
    expect(hasExactTimings(timings, [{ captionBeats: null }])).toBe(false)
    expect(hasExactTimings(timings, [])).toBe(false)
  })

  it('startMs 存在但类型不对（字符串）→ false，不误判为精确时长', () => {
    expect(hasExactTimings(timings, [{ captionBeats: [{ zh: '一句', startMs: '0' }] }])).toBe(false)
  })
})
