import { Worker, type Job } from 'bullmq'
import { prisma, transitionTask, canTransition, redisConnection } from '@mixcut/db'
import { segmentScript } from './jobs/segmentScript'
import { matchMaterials } from './jobs/matchMaterials'
import { renderDraft } from './jobs/renderDraft'
import { runQc } from './jobs/runQc'

async function dispatch(job: Job): Promise<void> {
  const { taskId } = job.data as { taskId: string }
  console.log(`[worker] ${job.name} start task=${taskId}`)
  switch (job.name) {
    case 'segment-script': return segmentScript(taskId)
    case 'match-materials': return matchMaterials(taskId)
    case 'render-draft': return renderDraft(taskId)
    case 'run-qc': return runQc(taskId)
    default: throw new Error(`未知 job: ${job.name}`)
  }
}

const worker = new Worker('pipeline', dispatch, { connection: redisConnection, concurrency: 2 })

worker.on('completed', (job) => console.log(`[worker] ${job.name} done task=${job.data.taskId}`))
worker.on('failed', async (job, err) => {
  console.error(`[worker] ${job?.name} failed: ${err.message}`)
  const taskId = job?.data?.taskId as string | undefined
  if (!taskId) return
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (task && canTransition(task.status, 'FAILED')) {
      await transitionTask(taskId, 'FAILED', `${job?.name} 失败：${err.message}`)
    }
  } catch (e) {
    console.error('[worker] 记录失败状态出错', e)
  }
})

console.log('[worker] pipeline worker started')

import { startGenWorker } from './gen'
startGenWorker()

// 超时兜底后被抛弃的 job promise 若晚到 reject 不应拖垮整个 worker（保住并发中的其它任务）
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection (已容错，不退出):', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException (已容错，不退出):', err)
})
