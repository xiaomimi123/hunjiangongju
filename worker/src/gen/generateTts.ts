import { promises as fs } from 'fs'
import { runCmd, probeText } from '../runCmd'
import path from 'path'
import { prisma, ttsSynthesize, setGenerationStatus, enqueueGen, withRetry, timeCaptionBeats, isValidVoice, isPlausibleVoiceId } from '@mixcut/db'
import { parseTemplateParams } from '../../templates/booklist/templateParams'
import { slotDurationsForSegments, speechCapacities, openFlashWindowMs, BOOK_TITLE_LEAD_MS } from '@mixcut/db'
import { DATA_DIR } from '../paths'

/** 配音超出槽位这个倍数才动手压；以下的零头交给画面自然吸收，不值得为它变速 */
const PACE_TOLERANCE = 1.06
/**
 * 变速上限。1.25× 以内听感仍自然（豆包语速本就偏慢）；再快就开始有"赶话"感，
 * 那时宁可让该段画面变长，也不把话说成机关枪——并记一条告警提示配额要重标定。
 */
const MAX_TEMPO = 1.25

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
/**
 * 保音高变速：把音频压到 targetMs（只压不拉）。
 *
 * 用 atempo 而不是改采样率——atempo 只动语速、**不动音高**。
 * 原先这里的策略是「只补不压」，理由写的是「变速会把声音捏尖」；
 * 那个理由对重采样成立，对 atempo 不成立，所以策略改掉了。
 * 压回槽位是「复刻剪映工程」这个目标的直接要求：不压的话，
 * 某一段配音超长就会把整条时间轴顶开（线上实测一段顶出 7 秒）。
 *
 * @returns 实际使用的变速倍数（1 表示没压）
 */
export async function compressTo(audioAbs: string, curMs: number, targetMs: number, maxFactor: number): Promise<number> {
  const want = curMs / targetMs
  if (!Number.isFinite(want) || want <= 1) return 1
  const factor = Math.min(want, maxFactor)
  const tmp = `${audioAbs}.tempo.wav`
  const r = await runCmd('ffmpeg',
    ['-y', '-i', audioAbs, '-af', `atempo=${factor.toFixed(4)}`, '-ar', '48000', '-ac', '1', tmp])
  if (!r.ok) throw new Error(`配音变速失败: ${r.out.slice(-400)}`)
  await fs.rename(tmp, audioAbs)
  return factor
}

/**
 * 在音频**开头**插入静音。
 *
 * 用途：快闪结束后先静一下，书名才出口——原片的节奏是「今天分享的是…」说完，
 * 书封一张张翻过去（无旁白），停顿一下，再报书名。
 */
export async function prependSilence(audioAbs: string, leadMs: number): Promise<void> {
  const tmp = `${audioAbs}.lead.wav`
  const r = await runCmd('ffmpeg',
    ['-y', '-i', audioAbs, '-af', `adelay=${Math.round(leadMs)}:all=1`, '-ar', '48000', '-ac', '1', tmp])
  if (!r.ok) throw new Error(`插入前置留白失败: ${r.out.slice(-400)}`)
  await fs.rename(tmp, audioAbs)
}

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
  const openFlashMs = openFlashWindowMs(tp)

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
  // ★ 必须与字数配额共用同一份槽位表（slotDurationsForSegments）。
  // 第一版这里直接取 `slotDurationsMs[i-1]`：配额按"滤掉纯画面段后"的列表分，
  // 补静音却按原始列表取——第 1 段拿到 781ms 的目标却被分了 27 个字（约 4.5 秒），
  // 补不了静音，那一段直接超出 3.7 秒。
  // 第二版改成共用 speechSlotDurations，但两侧传的 segCount 仍然不同
  //（文案侧含开场白那一段、配音侧不含），配额表整体错位一格。
  // 现在两侧都取同一份含第 0 格（开场+快闪）的完整槽位表。
  const timelineMs = slotDurationsForSegments(openFlashMs, tp.body.slotDurationsMs, segments.length)
  // 「占多长」与「能说多久」是两件事：快闪期间无旁白、书名前留 400ms，
  // 这些留白是节奏的一部分，不能拿来塞话（见 speechCapacities）。
  const speechCap = speechCapacities(timelineMs, tp.open.durationMs)
  // 草稿没给正片槽位时回退老行为：只有第 0 段按开场+快闪窗口对齐
  const slotFor = (i: number): number | undefined =>
    timelineMs[i] ?? (i === 0 && openFlashMs > 0 ? openFlashMs : undefined)
  const capFor = (i: number): number | undefined => speechCap[i] ?? slotFor(i)

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
    const slotMs = slotFor(i)
    const capMs = capFor(i)

    // ① 话太长 → 保音高压到「能说话的时长」（不是占位时长，否则会把留白吃掉）
    if (capMs && speechMs > capMs * PACE_TOLERANCE) {
      const used = await compressTo(clipPath, speechMs, capMs, MAX_TEMPO)
      durMs = (await probeDurationMs(clipPath)) || speechMs / used
      const over = Math.round((durMs / capMs - 1) * 100)
      const msg = `[gen] generate-tts ${genTaskId}: 第 ${i} 段配音 ${Math.round(speechMs)}ms 超可说话时长 ${capMs}ms，变速 ${used.toFixed(2)}× → ${Math.round(durMs)}ms`
      if (over > 1) console.warn(`${msg}（仍超 +${over}%，已到变速上限 ${MAX_TEMPO}×）`)
      else console.log(msg)
    }

    // ② 正片第 1 段：书名出口前先留白
    if (i === 1 && timelineMs.length > 0 && BOOK_TITLE_LEAD_MS > 0) {
      await prependSilence(clipPath, BOOK_TITLE_LEAD_MS)
      durMs = (await probeDurationMs(clipPath)) || durMs + BOOK_TITLE_LEAD_MS
    }

    // ③ 短于槽位 → 段尾补静音，精确落回草稿的切点
    if (slotMs && slotMs > durMs) {
      const was = durMs
      await padSilenceTo(clipPath, slotMs)
      durMs = (await probeDurationMs(clipPath)) || slotMs
      console.log(`[gen] generate-tts ${genTaskId}: 第 ${i} 段补静音 ${Math.round(was)}→${Math.round(durMs)}ms（对齐草稿槽位 ${slotMs}ms）`)
    } else if (slotMs && durMs > slotMs * PACE_TOLERANCE) {
      console.warn(`[gen] generate-tts ${genTaskId}: 第 ${i} 段 ${Math.round(durMs)}ms 仍超槽位 ${slotMs}ms（+${Math.round((durMs / slotMs - 1) * 100)}%），该段画面会相应变长`)
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
