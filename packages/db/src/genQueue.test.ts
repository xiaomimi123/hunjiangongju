import { describe, it, expect } from 'vitest'
import { queueNameFor, type GenJobName } from './genQueue'

// ★ 出片链路里两类步骤的瓶颈完全不同:网络型(文案/生图/配音)纯等 API 不吃 CPU,
// CPU 型(渲染/合成)吃满核。挤在同一队列时并发只能按较严的那个(核数)设,
// 于是一条片子在渲染时另一条连生图都排不上 —— 而那时网络完全空闲。
describe('queueNameFor —— 网络型与 CPU 型分队列', () => {
  it('渲染与合成走 CPU 队列', () => {
    expect(queueNameFor('render-visuals')).toBe('generation-cpu')
    expect(queueNameFor('render-video')).toBe('generation-cpu')
  })

  // 这几步是纯等 API,放 CPU 队列会白白占用本该给 ffmpeg 的 slot
  it('文案/生图/配音走网络队列', () => {
    for (const n of ['select-books', 'generate-script', 'generate-image', 'generate-tts'] as GenJobName[]) {
      expect(queueNameFor(n), `${n} 不该占 CPU 队列`).toBe('generation')
    }
  })

  it('其余轻量步骤默认走网络队列', () => {
    for (const n of ['align-captions', 'run-gen-qc', 'transcribe', 'extract-framework'] as GenJobName[]) {
      expect(queueNameFor(n)).toBe('generation')
    }
  })

  // 队列名是 Redis 里的 key,改名等于把在途任务丢在旧队列里没人消费。
  // 网络队列必须沿用 'generation' 这个原名。
  it('网络队列沿用原队列名，不丢在途任务', () => {
    expect(queueNameFor('generate-script')).toBe('generation')
  })
})
