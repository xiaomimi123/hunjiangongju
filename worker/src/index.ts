import { Worker } from 'bullmq'
import { redisConnection } from '@mixcut/db'
import { startGenWorker } from './gen'
import { processCozeRun, recoverFailedCozeRun } from './coze/run'

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
  w.on('failed', (j, err) => {
    console.error(`[coze] run ${j?.data?.runId} failed: ${err.message}`)
    // 兜底：processCozeRun 内部已经把绝大多数失败收口到 failRun（状态 FAILED + 幂等退分），
    // 但 failRun 自身也可能抛错（DB 抖动、用户已被删除等），事务回滚后 run 会永远停在
    // RUNNING、钱回不来——这里补一次，failRun 自带状态闸+退分闸，重复调用是安全的。
    // 与 gen worker 的 attach() 在 'failed' 里落终态的做法对齐。
    const runId = (j?.data as { runId?: string } | undefined)?.runId
    if (runId) {
      recoverFailedCozeRun(runId, `任务处理异常: ${err.message}`).catch((e) => {
        console.error(`[coze] run ${runId} 兜底 failRun 也失败: ${(e as Error).message}`)
      })
    }
  })
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
