import { Queue } from 'bullmq'
import { redisConnection } from './queue'

// 独立队列（同 coze-run 的理由）：实拍生图纯网络等待，与出片渲染、扣子工作流互不占并发。
const queues = new Map<string, Queue>()
function getQueue(): Queue {
  let existing = queues.get('photo-gen')
  if (!existing) {
    existing = new Queue('photo-gen', { connection: redisConnection })
    queues.set('photo-gen', existing)
  }
  return existing
}

// job payload 固定为 { runId }——worker 读 job.data.runId。
export async function enqueuePhotoGenRun(runId: string): Promise<void> {
  await getQueue().add('photo-gen', { runId }, { removeOnComplete: 100, removeOnFail: 500 })
}
