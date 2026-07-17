import { Worker, type Job } from 'bullmq'
import { prisma, redisConnection, setGenerationStatus, setSourceStatus, transitionRender } from '@mixcut/db'
import { generateScript } from './generateScript'
import { generateImage } from './generateImage'
import { generateTts } from './generateTts'
import { alignCaptions } from './alignCaptions'
import { renderVisuals } from './renderVisuals'
import { renderVideo } from './renderVideo'
import { runGenQc } from './runGenQc'
import { downloadDouyin } from './downloadDouyin'
import { transcribe } from './transcribe'
import { detectScenesJob } from './detectScenes'
import { extractFramework } from './extractFramework'

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
    case 'download-douyin':
      return downloadDouyin(job.data.sourceVideoId)
    case 'transcribe':
      return transcribe(job.data.sourceVideoId)
    case 'detect-scenes':
      return detectScenesJob(job.data.sourceVideoId)
    case 'extract-framework':
      return extractFramework(job.data.sourceVideoId)
    // 各 job 由后续任务接入；未实现先抛错，避免静默
    default: throw new Error(`未接入 gen job: ${job.name}`)
  }
}

export function startGenWorker() {
  // 真实出片的单步很重：8+ 张文生图(async)、HyperFrames 渲染与 ffmpeg 合成走 spawnSync 会阻塞事件循环，
  // 单步可达数分钟，远超 BullMQ 默认 30s 锁；锁一过期就被误判 stalled → 反复重试、产生重复渲染，
  // 且失败重试会把父 generationTask 置 FAILED（成片其实已 PREVIEW_PENDING，前后端却显示“生成失败”）。
  // 把锁设足够长以覆盖最长单步（阻塞期间无法续期，只能靠一次锁足够久），并放宽 stalled 容忍次数。
  const w = new Worker('generation', dispatch, {
    connection: redisConnection,
    concurrency: 2,
    lockDuration: 600_000, // 10 分钟
    maxStalledCount: 3,
  })
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
