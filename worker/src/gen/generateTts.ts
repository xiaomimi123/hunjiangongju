import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma, ttsSynthesize, setGenerationStatus, enqueueGen, withRetry, timeCaptionBeats } from '@mixcut/db'
import { DATA_DIR } from '../paths'

// 纯函数：从 GenerationTask.variables（Json）中取出运营在生成表单里选的克隆音色 voiceId。
export function readVoiceId(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return undefined
  const voiceId = (variables as Record<string, unknown>).voiceId
  return typeof voiceId === 'string' && voiceId.trim() ? voiceId.trim() : undefined
}

function probeDurationMs(audioAbs: string): number {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioAbs],
    { encoding: 'utf8' },
  )
  const durSec = parseFloat((r.stdout ?? '').trim())
  return Number.isFinite(durSec) && durSec > 0 ? durSec * 1000 : 0
}

// 把多个音频切片按顺序无缝拼成一条 wav（concat filter 会重采样统一格式，容忍各片格式不一）。
function concatClips(clipPaths: string[], outAbs: string): void {
  const inputs = clipPaths.flatMap((p) => ['-i', p])
  const filter = clipPaths.map((_p, i) => `[${i}:a]`).join('') + `concat=n=${clipPaths.length}:v=0:a=1[a]`
  const r = spawnSync(
    'ffmpeg',
    ['-y', ...inputs, '-filter_complex', filter, '-map', '[a]', '-ar', '48000', '-ac', '1', outAbs],
    { encoding: 'utf8', stdio: 'pipe' },
  )
  if (r.status !== 0) throw new Error(`拼接配音失败: ${(r.stderr ?? '').slice(-400)}`)
}

type Beat = { zh: string; en?: string }
// 从 captionBeats（Json）取出可朗读的短句；脏数据/空数组时回退整段 scriptText，
// 保证每段至少有一次配音（否则该段无音频，后面累加的段起止会整体错位）。
export function parseBeats(captionBeats: unknown, fallbackText: string): Beat[] {
  const raw = Array.isArray(captionBeats) ? (captionBeats as { zh?: unknown; en?: unknown }[]) : []
  const beats = raw
    .filter((b) => b && typeof b.zh === 'string' && b.zh.trim())
    .map((b) => ({ zh: (b.zh as string).trim(), ...(typeof b.en === 'string' && b.en.trim() ? { en: b.en.trim() } : {}) }))
  return beats.length ? beats : [{ zh: fallbackText }]
}

/**
 * 逐「分段」配音 + 拼接：
 * 关键——段级时间不再靠 silencedetect「猜」，而是取每段配音的真实时长（ffprobe），累加得到每段
 * 精确起止（bodyTimings）。字幕节拍（短句）再在本段的精确窗口内按字数分布，写回 captionBeats
 * 的 startMs/endMs。这样字幕与音频在段级严格对齐（消除整段级错位——用户反馈的「根本对不上」），
 * 段内短句误差被限制在单段窗口内、每段起点自动重新对齐。
 * 为何按段而非按句：qwen-tts 有 QPS/QPM 限流，逐句(十几~几十次调用)会触发 429；按段仅 N 次调用，稳。
 * 结果：align-captions 检测到精确时长后跳过 silencedetect，也不做源节奏 re-timing。
 */
export async function generateTts(genTaskId: string): Promise<void> {
  const [task, segments] = await Promise.all([
    prisma.generationTask.findUnique({ where: { id: genTaskId }, select: { variables: true } }),
    prisma.generatedSegment.findMany({ where: { generationTaskId: genTaskId }, orderBy: { seqNo: 'asc' } }),
  ])
  const voiceId = readVoiceId(task?.variables)

  const dir = path.join(DATA_DIR, 'gen', genTaskId)
  const clipsDir = path.join(dir, 'clips')
  await fs.rm(clipsDir, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(clipsDir, { recursive: true })

  const clipPaths: string[] = []
  const bodyTimings: { seqNo: number; startMs: number; endMs: number }[] = []
  let cursorMs = 0

  for (const [i, seg] of segments.entries()) {
    const beats = parseBeats(seg.captionBeats, seg.scriptText)
    // 整段一次配音（节拍拼回整段文本朗读，保证语流自然、且只占一次限流额度）。
    const segText = beats.map((b) => b.zh).join('，')
    const audio = await withRetry(() => ttsSynthesize({ text: segText, ...(voiceId ? { voiceId } : {}) }), {
      attempts: 4,
      delayMs: 4000, // 429 限流窗口较长，退避给足
      onRetry: (err, n) =>
        console.warn(`[gen] generate-tts ${genTaskId} 段#${i} 第${n}次失败,重试: ${(err as Error).message?.slice(0, 90)}`),
    })
    const clipPath = path.join(clipsDir, `c${i}.wav`)
    await fs.writeFile(clipPath, audio)
    const durMs = probeDurationMs(clipPath) || 2000 // 探测失败给个兜底时长
    clipPaths.push(clipPath)

    const segStart = Math.round(cursorMs)
    const segEnd = Math.round(cursorMs + durMs)
    // 段内短句：在本段【精确】窗口内按字数分布（timeCaptionBeats），带 startMs/endMs 写回。
    const timedBeats = timeCaptionBeats(beats.map((b) => ({ zh: b.zh, en: b.en })), segStart, segEnd)
    await prisma.generatedSegment.update({ where: { id: seg.id }, data: { captionBeats: timedBeats } })
    bodyTimings.push({ seqNo: seg.seqNo, startMs: segStart, endMs: segEnd })
    cursorMs += durMs
  }

  const fullAbs = path.join(dir, 'full_audio.wav')
  concatClips(clipPaths, fullAbs)
  await fs.rm(clipsDir, { recursive: true, force: true }).catch(() => {})

  const fullAudioUrl = `/api/files/gen/${genTaskId}/full_audio.wav`
  await prisma.generationTask.update({ where: { id: genTaskId }, data: { fullAudioUrl, bodyTimings } })
  console.log(`[gen] generate-tts ${genTaskId}: 逐段配音 ${segments.length} 段, 精确总时长 ${Math.round(cursorMs)}ms`)

  await setGenerationStatus(genTaskId, 'CAPTION_ALIGNING')
  await enqueueGen('align-captions', { genTaskId })
}
