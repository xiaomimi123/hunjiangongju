import { promises as fs } from 'fs'
import { runCmd, probeText } from '../runCmd'
import path from 'path'
import { prisma, ttsSynthesize, setGenerationStatus, enqueueGen, withRetry, timeCaptionBeats, isValidVoice, isPlausibleVoiceId } from '@mixcut/db'
import { parseTemplateParams } from '../../templates/booklist/templateParams'
import { speechSlotDurations } from '@mixcut/db'
import { DATA_DIR } from '../paths'

// 纯函数：从 GenerationTask.variables（Json）中取出运营在生成表单里选的克隆音色 voiceId。
export function readVoiceId(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return undefined
  const voiceId = (variables as Record<string, unknown>).voiceId
  return typeof voiceId === 'string' && voiceId.trim() ? voiceId.trim() : undefined
}

// 纯函数：从 GenerationTask.variables（Json）中取出运营选的普通音色 voice。
// 内置白名单命中，或形如合法音色 id（含火山克隆 S_ 开头、DB customVoices 里登记的音色）都放行；防注入。
export function readVoice(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return undefined
  const voice = (variables as Record<string, unknown>).voice
  return isValidVoice(voice) || isPlausibleVoiceId(voice) ? (voice as string) : undefined
}

async function probeDurationMs(audioAbs: string): Promise<number> {
  const out = await probeText('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioAbs])
  const durSec = parseFloat(out)
  return Number.isFinite(durSec) && durSec > 0 ? durSec * 1000 : 0
}

/**
 * 在音频末尾补静音，使总长度达到 targetMs（**只补不截**）。
 *
 * 用 apad 的 whole_dur：它按目标总时长补，而不是按「补多少」，
 * 省得先探测再算差值——少一步就少一处四舍五入。
 * 原地替换：先写临时文件再改名，避免 ffmpeg 读写同一个文件产出空文件。
 */
async function padSilenceTo(audioAbs: string, targetMs: number): Promise<void> {
  const tmp = `${audioAbs}.pad.wav`
  const r = await runCmd('ffmpeg',
    ['-y', '-i', audioAbs, '-af', `apad=whole_dur=${(targetMs / 1000).toFixed(3)}`, '-ar', '48000', '-ac', '1', tmp])
  if (!r.ok) throw new Error(`补静音失败: ${r.out.slice(-400)}`)
  await fs.rename(tmp, audioAbs)
}

// 把多个音频切片按顺序无缝拼成一条 wav（concat filter 会重采样统一格式，容忍各片格式不一）。
async function concatClips(clipPaths: string[], outAbs: string): Promise<void> {
  const inputs = clipPaths.flatMap((p) => ['-i', p])
  const filter = clipPaths.map((_p, i) => `[${i}:a]`).join('') + `concat=n=${clipPaths.length}:v=0:a=1[a]`
  const r = await runCmd('ffmpeg',
    ['-y', ...inputs, '-filter_complex', filter, '-map', '[a]', '-ar', '48000', '-ac', '1', outAbs])
  if (!r.ok) throw new Error(`拼接配音失败: ${r.out.slice(-400)}`)
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
    prisma.generationTask.findUnique({
      where: { id: genTaskId },
      select: { variables: true, framework: { select: { overlayTemplate: true } } },
    }),
    prisma.generatedSegment.findMany({ where: { generationTaskId: genTaskId }, orderBy: { seqNo: 'asc' } }),
  ])
  const voiceId = readVoiceId(task?.variables)
  const voice = readVoice(task?.variables)

  const dir = path.join(DATA_DIR, 'gen', genTaskId)
  const clipsDir = path.join(dir, 'clips')
  await fs.rm(clipsDir, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(clipsDir, { recursive: true })

  // ── 第 0 段要占满草稿的「开场 + 快闪」窗口 ──
  //
  // 第 0 段在 flash 模板里不出字幕，它的时间窗就是开场碎裂 + 书封快闪的总长度
  // （indexHtml 的 flashTimeline 直接拿它切开场与快闪）。而这一段的旁白很短
  // （「今天分享的是《X》」约 2.2 秒），窗口就被压到 2.2 秒——草稿是 3.98 秒，
  // 快闪被硬生生压缩，9 张书封挤在不到 2 秒里闪完。
  //
  // 解法是把第 0 段的**音频**补静音到草稿长度：画面时间轴是从 bodyTimings 来的，
  // 音频一对齐，快闪与正片起点自动就跟草稿一致，不会音画错位。
  // 静音补在旁白**之后**——与草稿一致：开场念标题，快闪那 1.8 秒只有齿轮音。
  const tp = parseTemplateParams(
    (task?.framework?.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams,
  )
  const flashTotalMs = (tp.flash.clipMs ?? []).reduce((a, b) => a + b, 0)
  const openFlashMs = tp.mode === 'flash' && flashTotalMs > 0 ? tp.open.durationMs + flashTotalMs : 0

  // ── 正片各段补静音到草稿的分镜时长 ──
  //
  // 段时长原先完全等于该段配音的长度，于是节奏由文案长短决定：实测成片正片三段是
  // 3.6/4.2/9.4 秒（最后一张图挂了 9.4 秒），而草稿是 5.7/8.1/6.1。
  //
  // 现在文案已按草稿各段时长分配字数（deriveSlotCharBudgets），配音长度本就接近目标；
  // 这里再补静音把它对齐到目标，画面切点就落在草稿的位置上。
  //
  // **只补不压**：配音比目标长时不做变速。变速会改音高与语流，
  // 而「话说得比原片满一点」远比「声音被捏尖」可接受。超出多少记一条日志，
  // 长期超出说明字数配额需要重新标定，不该靠变速掩盖。
  // ★ 必须与字数配额共用同一份槽位时长（speechSlotDurations）。
  // 第一版这里直接取 `slotDurationsMs[i-1]`：配额按"滤掉纯画面段后"的列表分，
  // 补静音却按原始列表取——第 1 段拿到 781ms 的目标却被分了 27 个字（约 4.5 秒），
  // 补不了静音，那一段直接超出 3.7 秒。
  // 第 0 段是开场+快闪窗口，不在正片槽位里；正片从第 1 段起对应下标 0。
  const bodySlots = speechSlotDurations(tp.body.slotDurationsMs, Math.max(1, segments.length - 1))
  const slotFor = (i: number): number | undefined => (i >= 1 ? bodySlots[i - 1] : undefined)

  const clipPaths: string[] = []
  const bodyTimings: { seqNo: number; startMs: number; endMs: number }[] = []
  let cursorMs = 0

  for (const [i, seg] of segments.entries()) {
    const beats = parseBeats(seg.captionBeats, seg.scriptText)
    // 整段一次配音（节拍拼回整段文本朗读，保证语流自然、且只占一次限流额度）。
    const segText = beats.map((b) => b.zh).join('，')
    const audio = await withRetry(
      () => ttsSynthesize({ text: segText, ...(voiceId ? { voiceId } : {}), ...(voice ? { voice } : {}) }),
      {
        attempts: 4,
        delayMs: 4000, // 429 限流窗口较长，退避给足
        onRetry: (err, n) =>
          console.warn(`[gen] generate-tts ${genTaskId} 段#${i} 第${n}次失败,重试: ${(err as Error).message?.slice(0, 90)}`),
      },
    )
    const clipPath = path.join(clipsDir, `c${i}.wav`)
    await fs.writeFile(clipPath, audio)
    const speechMs = (await probeDurationMs(clipPath)) || 2000 // 探测失败给个兜底时长
    // 第 0 段补静音到草稿的开场+快闪长度（只补不截：旁白比草稿还长时按旁白走，
    // 截断会把话说到一半切掉）
    let durMs = speechMs
    if (i === 0 && openFlashMs > speechMs) {
      await padSilenceTo(clipPath, openFlashMs)
      durMs = (await probeDurationMs(clipPath)) || openFlashMs
      console.log(`[gen] generate-tts ${genTaskId}: 第 0 段补静音 ${Math.round(speechMs)}→${Math.round(durMs)}ms（对齐草稿开场+快闪）`)
    }
    const slotMs = slotFor(i)
    if (slotMs && slotMs > speechMs) {
      await padSilenceTo(clipPath, slotMs)
      durMs = (await probeDurationMs(clipPath)) || slotMs
      console.log(`[gen] generate-tts ${genTaskId}: 第 ${i} 段补静音 ${Math.round(speechMs)}→${Math.round(durMs)}ms（对齐草稿分镜 ${slotMs}ms）`)
    } else if (slotMs && speechMs > slotMs * 1.06) {
      // 只记不改：见上面「只补不压」。持续出现说明字数配额偏松，要回头调 deriveSlotCharBudgets
      console.warn(`[gen] generate-tts ${genTaskId}: 第 ${i} 段配音 ${Math.round(speechMs)}ms 超出草稿分镜 ${slotMs}ms（+${Math.round((speechMs / slotMs - 1) * 100)}%），该段画面会相应变长`)
    }
    clipPaths.push(clipPath)

    const segStart = Math.round(cursorMs)
    const segEnd = Math.round(cursorMs + durMs)
    // 段内短句：按**旁白**的长度分布，不是按补过静音的窗口——
    // 否则第 0 段的字幕会被摊到静音段上（flash 模板不出第 0 段字幕，但 classic 会）。
    const timedBeats = timeCaptionBeats(beats.map((b) => ({ zh: b.zh, en: b.en })), segStart, Math.round(cursorMs + speechMs))
    await prisma.generatedSegment.update({ where: { id: seg.id }, data: { captionBeats: timedBeats } })
    bodyTimings.push({ seqNo: seg.seqNo, startMs: segStart, endMs: segEnd })
    cursorMs += durMs
  }

  const fullAbs = path.join(dir, 'full_audio.wav')
  await concatClips(clipPaths, fullAbs)
  await fs.rm(clipsDir, { recursive: true, force: true }).catch(() => {})

  const fullAudioUrl = `/api/files/gen/${genTaskId}/full_audio.wav`
  await prisma.generationTask.update({ where: { id: genTaskId }, data: { fullAudioUrl, bodyTimings } })
  console.log(`[gen] generate-tts ${genTaskId}: 逐段配音 ${segments.length} 段, 精确总时长 ${Math.round(cursorMs)}ms`)

  await setGenerationStatus(genTaskId, 'CAPTION_ALIGNING')
  await enqueueGen('align-captions', { genTaskId })
}
