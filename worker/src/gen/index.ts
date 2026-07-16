import { Worker, type Job } from 'bullmq'
import { prisma, redisConnection, setGenerationStatus, setSourceStatus, transitionRender } from '@mixcut/db'
import { generateScript } from './generateScript'
import { generateImage } from './generateImage'
import { generateTts } from './generateTts'
import { alignCaptions } from './alignCaptions'
import { renderVisuals } from './renderVisuals'
import { renderVideo } from './renderVideo'
import { runGenQc } from './runGenQc'

async function dispatch(job: Job): Promise<void> {
  console.log(`[gen] ${job.name}`, job.data)
  switch (job.name) {
    case 'generate-script':
      return generateScript(job.data.genTaskId)
    case 'generate-image':
      return generateImage(job.data.genTaskId)
    case 'generate-tts':
      return generateTts(job.data.genTaskId)
    case 'align-captions':
      return alignCaptions(job.data.genTaskId)
    case 'render-visuals':
      return renderVisuals(job.data.genTaskId)
    case 'render-video':
      return renderVideo(job.data.renderTaskId)
    case 'run-gen-qc':
      return runGenQc(job.data.renderTaskId)
    // 各 job 由后续任务接入；未实现先抛错，避免静默
    default: throw new Error(`未接入 gen job: ${job.name}`)
  }
}

export function startGenWorker() {
  const w = new Worker('generation', dispatch, { connection: redisConnection, concurrency: 2 })
  w.on('completed', (j) => console.log(`[gen] ${j.name} done`))
  w.on('failed', async (j, err) => {
    console.error(`[gen] ${j?.name} failed: ${err.message}`)
    const d = (j?.data ?? {}) as { genTaskId?: string; renderTaskId?: string; sourceVideoId?: string }
    try {
      if (d.renderTaskId) await transitionRender(d.renderTaskId, 'FAILED', `${j?.name}: ${err.message}`).catch(() => {})
      else if (d.sourceVideoId) await setSourceStatus(d.sourceVideoId, 'FAILED').catch(() => {})
      else if (d.genTaskId) await setGenerationStatus(d.genTaskId, 'FAILED').catch(() => {})
    } catch {}
  })
  console.log('[gen] generation worker started')
  return w
}
