import { Worker, type Job } from 'bullmq'
import { prisma, redisConnection, setGenerationStatus, setSourceStatus, transitionRender, enqueueGen, queueNameFor, type GenJobName } from '@mixcut/db'
import { selectBooks } from './selectBooks'
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
  // ★ 拆队列那一刻已经排在旧队列（generation）里的渲染任务，会被**网络 worker**
  // 以并发 8 领走 —— 4 核机器上同时起 8 个 ffmpeg。转投到 CPU 队列而不是就地执行。
  // 这段在旧任务排空后就再也不会触发，但少了它那一次部署会很难看。
  if (job.queueName === 'generation' && queueNameFor(job.name as GenJobName) === 'generation-cpu') {
    console.log(`[gen] ${job.name} 来自旧队列，转投 CPU 队列`)
    await enqueueGen(job.name as GenJobName, job.data)
    return
  }
  console.log(`[gen] ${job.name}`, job.data)
  switch (job.name) {
    case 'select-books':
      return selectBooks(job.data.genTaskId)
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

/**
 * 网络型任务的并发。
 *
 * 文案/生图/配音都是纯等 API，不吃 CPU，所以可以开得比核数高得多。
 * 上限由**AI 接口的 QPS**决定而不是机器：开太高只会换来 429 与退避重试。
 * 8 是个保守起点——单条片子同时最多也就一两个网络步骤在跑。
 */
const NET_CONCURRENCY = Number(process.env.GEN_NET_CONCURRENCY ?? 8)

/**
 * CPU 型任务的并发。
 *
 * 渲染吃满核。服务器 4 核，留 1 核给 web/db，2 是稳妥值。
 * 内存也是约束：7G 里可用约 5G，并发渲染开到 3 有 OOM 风险。
 */
const CPU_CONCURRENCY = Number(process.env.GEN_CPU_CONCURRENCY ?? 2)

function attach(w: Worker): Worker {
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
  return w
}

/**
 * 起两个 worker：网络型与 CPU 型分开，各按各的瓶颈设并发。
 *
 * 锁时长仍设 10 分钟：外部命令已改异步（不再阻塞事件循环、锁能正常续期），
 * 但单个渲染本身就可能跑几分钟，锁短了会被误判 stalled → 重复渲染，
 * 且失败重试会把父 generationTask 置 FAILED（成片其实已出好，前后端却显示"生成失败"）。
 *
 * 网络队列沿用原队列名 'generation'：队列名是 Redis 里的 key，
 * 改名等于把在途任务丢在旧队列里没人消费。旧队列里的渲染任务由 dispatch 转投 CPU 队列。
 */
export function startGenWorker(): Worker[] {
  const opts = { connection: redisConnection, lockDuration: 600_000, maxStalledCount: 3 }
  const net = attach(new Worker('generation', dispatch, { ...opts, concurrency: NET_CONCURRENCY }))
  const cpu = attach(new Worker('generation-cpu', dispatch, { ...opts, concurrency: CPU_CONCURRENCY }))
  console.log(`[gen] generation worker started (net=${NET_CONCURRENCY}, cpu=${CPU_CONCURRENCY})`)
  return [net, cpu]
}
