import { Worker, type Job } from 'bullmq'
import { prisma, redisConnection, setGenerationStatus, transitionRender } from '@mixcut/db'

async function dispatch(job: Job): Promise<void> {
  console.log(`[gen] ${job.name}`, job.data)
  switch (job.name) {
    // 各 job 由后续任务接入；未实现先抛错，避免静默
    default: throw new Error(`未接入 gen job: ${job.name}`)
  }
}

export function startGenWorker() {
  const w = new Worker('generation', dispatch, { connection: redisConnection, concurrency: 2 })
  w.on('completed', (j) => console.log(`[gen] ${j.name} done`))
  w.on('failed', async (j, err) => {
    console.error(`[gen] ${j?.name} failed: ${err.message}`)
    const d = (j?.data ?? {}) as { genTaskId?: string; renderTaskId?: string }
    try {
      if (d.renderTaskId) await transitionRender(d.renderTaskId, 'FAILED', `${j?.name}: ${err.message}`).catch(() => {})
      else if (d.genTaskId) await setGenerationStatus(d.genTaskId, 'FAILED').catch(() => {})
    } catch {}
  })
  console.log('[gen] generation worker started')
  return w
}
