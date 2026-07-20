import path from 'path'
import { describe, it, expect } from 'vitest'
import { canonicalFullAudioPath } from './alignCaptions'
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
