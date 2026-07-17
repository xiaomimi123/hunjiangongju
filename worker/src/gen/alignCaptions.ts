import { spawnSync } from 'child_process'
import {
  prisma,
  setGenerationStatus,
  enqueueGen,
  parseSilence,
  buildSpeech,
  coalesce,
  buildTimings,
  evenSplit,
  applyPace,
  type Timing,
  type PaceInfo,
} from '@mixcut/db'
import { urlToAbs } from '../paths'

const SKIP_LEADING = 1 // 跳过开头口播标题段

function probeDurationMs(audioAbs: string): number {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioAbs],
    { encoding: 'utf8' },
  )
  const durSec = parseFloat((r.stdout ?? '').trim())
  if (!Number.isFinite(durSec) || durSec <= 0) {
    throw new Error(`ffprobe 无法取得时长: ${audioAbs} (${r.stderr ?? ''})`)
  }
  return durSec * 1000
}

function runSilenceDetect(audioAbs: string): string {
  // 参考 §3：silencedetect=noise=-35dB:d=0.18，输出走 stderr，合并 stdout+stderr 抓取
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', audioAbs, '-af', 'silencedetect=noise=-35dB:d=0.18', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`
}

export async function alignCaptions(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({ where: { id: genTaskId } })
  if (!task.fullAudioUrl) throw new Error(`generation_task ${genTaskId} 缺少 fullAudioUrl`)

  const N = await prisma.generatedSegment.count({ where: { generationTaskId: genTaskId } })
  if (N < 1) throw new Error(`generation_task ${genTaskId} 无 generated_segments`)

  const audioAbs = urlToAbs(task.fullAudioUrl)
  const durationMs = probeDurationMs(audioAbs)

  // 主路径：silencedetect → speech → coalesce(N+skipLeading) → buildTimings(N)
  // 兜底：mock 全静音（无 speech 段）或段数不符 → 按总时长均分 N 段
  const speech = buildSpeech(durationMs, parseSilence(runSilenceDetect(audioAbs)))
  let timings: Timing[]
  let path: 'silencedetect' | 'even-split'
  if (speech.length < N) {
    timings = evenSplit(durationMs, N)
    path = 'even-split'
  } else {
    try {
      timings = buildTimings(N, coalesce(speech, N + SKIP_LEADING), SKIP_LEADING)
      path = 'silencedetect'
    } catch {
      timings = evenSplit(durationMs, N)
      path = 'even-split'
    }
  }
  console.log(`[gen] align-captions ${genTaskId}: ${path}, ${timings.length} 段, 时长 ${Math.round(durationMs)}ms`)

  // Task4 节奏对齐：框架若带有源节奏（overlayTemplate.pace，见 extractFramework.ts），
  // 把 TTS 实测时长朝源均段时长拉，但绝不短于 TTS 实测时长（applyPace 保证）。
  // 无 pace（如本地占位时间戳、旧任务）时 applyPace 原样返回，行为不变。
  const framework = await prisma.copyFramework.findUnique({ where: { id: task.frameworkId } })
  const overlayTemplate = (framework?.overlayTemplate ?? null) as { pace?: PaceInfo } | null
  const pace = overlayTemplate?.pace
  if (pace && typeof pace.avgSegMs === 'number') {
    const before = timings.length
    timings = applyPace(timings, pace)
    console.log(`[gen] align-captions ${genTaskId}: 应用源节奏 avgSegMs=${pace.avgSegMs} (${before} 段)`)
  }

  await prisma.generationTask.update({ where: { id: genTaskId }, data: { bodyTimings: timings } })
  await setGenerationStatus(genTaskId, 'ASSET_READY')
  if (task.autoRender) {
    // 学员任务：自动串联，无需运营手工确认合成。与运营 render 路由一致的前置：先置 VISUAL_RENDERING 再入队。
    await setGenerationStatus(genTaskId, 'VISUAL_RENDERING')
    await enqueueGen('render-visuals', { genTaskId })
    console.log(`[gen] align-captions ${genTaskId}: autoRender → enqueue render-visuals`)
  }
  // autoRender=false：停在 ASSET_READY，等运营确认合成，不 enqueue 下一步
}
