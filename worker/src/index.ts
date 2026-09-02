import { Worker } from 'bullmq'
import { redisConnection } from '@mixcut/db'
import { startGenWorker } from './gen'
import { processCozeRun } from './coze/run'

startGenWorker()

/**
 * 扣子工作流工具箱的消费端。独立队列 'coze-run'（见 packages/db/src/cozeQueue.ts）。
 *
 * 并发 2：扣子跑工作流全靠网络等待（不吃本机 CPU），但受扣子那边的并发/QPS 限制，
 * 2 是稳妥起点，跟 gen worker 网络队列的并发判断依据一致。
 * 锁时长 10 分钟：与 cozeRunWorkflow 的默认超时对齐，避免任务还没跑完就被判 stalled 重复消费。
 */
function startCozeWorker(): Worker {
  const w = new Worker(
    'coze-run',
    (job) => processCozeRun(job.data.runId),
    { connection: redisConnection, concurrency: 2, lockDuration: 600_000 },
  )
  w.on('completed', (j) => console.log(`[coze] run ${j.data.runId} done`))
  w.on('failed', (j, err) => console.error(`[coze] run ${j?.data?.runId} failed: ${err.message}`))
  return w
}

startCozeWorker()

// 超时兜底后被抛弃的 job promise 若晚到 reject 不应拖垮整个 worker（保住并发中的其它任务）
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection (已容错，不退出):', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException (已容错，不退出):', err)
})
