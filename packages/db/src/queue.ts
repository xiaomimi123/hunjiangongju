import { Queue } from 'bullmq'

export type JobName = 'segment-script' | 'match-materials' | 'render-draft' | 'run-qc'

export const redisConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
}

let queue: Queue | null = null
function getQueue(): Queue {
  if (!queue) queue = new Queue('pipeline', { connection: redisConnection })
  return queue
}

export async function enqueue(name: JobName, taskId: string): Promise<void> {
  await getQueue().add(name, { taskId }, { removeOnComplete: 100, removeOnFail: 500 })
}
