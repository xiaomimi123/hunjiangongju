import { Queue } from 'bullmq'
import { redisConnection } from './queue'

export type GenJobName =
  | 'generate-script' | 'generate-image' | 'generate-tts'
  | 'align-captions' | 'render-visuals' | 'render-video' | 'run-gen-qc'
  | 'download-douyin' | 'transcribe' | 'detect-scenes' | 'extract-framework'

let q: Queue | null = null
function genQueue(): Queue {
  if (!q) q = new Queue('generation', { connection: redisConnection })
  return q
}
export async function enqueueGen(name: GenJobName, payload: { genTaskId?: string; renderTaskId?: string; sourceVideoId?: string }): Promise<void> {
  await genQueue().add(name, payload, { removeOnComplete: 100, removeOnFail: 500 })
}
