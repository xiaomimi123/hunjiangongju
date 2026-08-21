import { Queue } from 'bullmq'
import { redisConnection } from './queue'

export type GenJobName =
  | 'select-books'
  | 'generate-script' | 'generate-image' | 'generate-tts'
  | 'align-captions' | 'render-visuals' | 'render-video' | 'run-gen-qc'
  | 'download-douyin' | 'transcribe' | 'detect-scenes' | 'extract-framework'

/**
 * ── 为什么要拆两个队列 ──
 *
 * 出片链路里两类步骤的瓶颈完全不同：
 *   · 网络型（文案/生图/配音）——纯等 API，几乎不吃 CPU。线上实测占单条片子约一半时间。
 *   · CPU 型（渲染/合成）——ffmpeg 吃满核。
 *
 * 挤在同一个队列里时，队列的并发度只能按**较严的那个**（CPU 核数）来设，
 * 于是网络型任务被 CPU 的容量限制住了：一条片子在渲染，另一条连生图都排不上，
 * 而那时 CPU 正忙、网络却完全空闲。
 *
 * 拆开后各按各的瓶颈设并发：网络队列可以开到十几个（受限于 API 的 QPS），
 * CPU 队列按核数限 2~3 个。同样的机器吞吐能翻倍以上。
 */
const CPU_JOBS = new Set<GenJobName>(['render-visuals', 'render-video'])

export function queueNameFor(name: GenJobName): 'generation' | 'generation-cpu' {
  return CPU_JOBS.has(name) ? 'generation-cpu' : 'generation'
}

const queues = new Map<string, Queue>()
function getQueue(qName: string): Queue {
  let existing = queues.get(qName)
  if (!existing) {
    existing = new Queue(qName, { connection: redisConnection })
    queues.set(qName, existing)
  }
  return existing
}

export async function enqueueGen(name: GenJobName, payload: { genTaskId?: string; renderTaskId?: string; sourceVideoId?: string }): Promise<void> {
  await getQueue(queueNameFor(name)).add(name, payload, { removeOnComplete: 100, removeOnFail: 500 })
}
