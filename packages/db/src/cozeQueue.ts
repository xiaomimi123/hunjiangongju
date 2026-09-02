import { Queue } from 'bullmq'
import { redisConnection } from './queue'

// 独立队列（不复用 genQueue 的 'generation'/'generation-cpu'）：
// 扣子工作流跑在扣子那边，本地只是发起+轮询/回调，跟出片链路的 CPU/网络瓶颈完全不相干，
// 混在一起会互相占用并发额度。
const queues = new Map<string, Queue>()
function getQueue(): Queue {
  let existing = queues.get('coze-run')
  if (!existing) {
    existing = new Queue('coze-run', { connection: redisConnection })
    queues.set('coze-run', existing)
  }
  return existing
}

// job payload 固定为 { runId }——这是与 worker 之间的跨任务契约，worker 读 job.data.runId。
export async function enqueueCozeRun(runId: string): Promise<void> {
  await getQueue().add('coze-run', { runId }, { removeOnComplete: 100, removeOnFail: 500 })
}
