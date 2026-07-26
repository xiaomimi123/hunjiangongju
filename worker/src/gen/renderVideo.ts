import { spawnSync } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import { prisma, transitionRender, buildSrt, enqueueGen } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { parseTemplateParams, flashTimeline } from '../../templates/booklist/templateParams'
import { resolveBooks } from './generateImage'

const WIDTH = 720
const HEIGHT = 960
// worker/src/gen → up 2 = worker/ → assets/sfx（齿轮/水滴音效，Task 9 加入实际文件；缺失时静默跳过）
const SFX_DIR = path.join(__dirname, '..', '..', 'assets', 'sfx')

interface Timing {
  seqNo: number
  startMs: number
  endMs: number
}

function probeDurationSec(mediaAbs: string): number {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mediaAbs],
    { encoding: 'utf8' },
  )
  const sec = parseFloat((r.stdout ?? '').trim())
  return Number.isFinite(sec) && sec > 0 ? sec : 0
}

function probeVideo(mp4Abs: string): { width: number; height: number; hasAudio: boolean } {
  const r = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height',
      '-of', 'json',
      mp4Abs,
    ],
    { encoding: 'utf8' },
  )
  let width = 0
  let height = 0
  let hasAudio = false
  try {
    const parsed = JSON.parse(r.stdout ?? '{}') as {
      streams?: { codec_type?: string; width?: number; height?: number }[]
    }
    for (const s of parsed.streams ?? []) {
      if (s.codec_type === 'video') {
        width = s.width ?? 0
        height = s.height ?? 0
      } else if (s.codec_type === 'audio') {
        hasAudio = true
      }
    }
  } catch {
    /* ignore parse error, treated as verification failure below */
  }
  return { width, height, hasAudio }
}

/** 构造 ffmpeg 参数：body 视觉 + 整篇配音（+可选 BGM/SFX）+ loudnorm，输出 final.mp4 */
export function buildFfmpegArgs(opts: {
  bodyAbs: string
  audioAbs: string
  bgmAbs: string | null
  durSec: number
  outAbs: string
  bgmVolume?: number
  sfx?: { gearAbs?: string; dropAbs?: string; openEndSec: number; dropAtSec: number }
}): string[] {
  const { bodyAbs, audioAbs, bgmAbs, durSec, outAbs, sfx } = opts
  const bgmVol = typeof opts.bgmVolume === 'number' ? opts.bgmVolume : 0.32
  const args = ['-y', '-i', bodyAbs, '-i', audioAbs]
  let idx = 2
  let bgmIdx = -1, gearIdx = -1, dropIdx = -1
  if (bgmAbs) { args.push('-stream_loop', '-1', '-i', bgmAbs); bgmIdx = idx++ }
  if (sfx?.gearAbs) { args.push('-i', sfx.gearAbs); gearIdx = idx++ }
  if (sfx?.dropAbs) { args.push('-i', sfx.dropAbs); dropIdx = idx++ }

  // 开场特效（ffmpeg 层，逐帧滤镜，可靠——HyperFrames 渲不出开场动画，故在合成阶段补）：
  // 前 ~1.1s 从黑淡入 + 画面由 1.12x 缓缓拉回到 1.0（电影感「揭开」）。on=输出帧号，30fps → 前 33 帧做缩放。
  const vfilter =
    "[0:v]zoompan=z='if(lte(on,33),1.12-0.12*on/33,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x960:fps=30,fade=t=in:st=0:d=0.7,format=yuv420p[v]"

  const aformat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
  // 人声后处理：把偏平的 TTS/克隆音色处理得更自然、厚实、有磁性——
  // 去低频隆隆(highpass) + 暖色/胸腔感(250Hz+) + 临场清晰(3.2k+) + 柔化齿音毛刺(7.2k-) +
  // 动态压缩(声音更稳更"贴脸") + 极轻空间反射(故事感)。
  const VOICE_FX =
    'highpass=f=85,equalizer=f=250:width_type=q:w=1.2:g=2.5,equalizer=f=3200:width_type=q:w=1.6:g=1.5,equalizer=f=7200:width_type=q:w=2:g=-3.5,acompressor=threshold=-18dB:ratio=3:attack=20:release=200:makeup=2,aecho=0.9:0.85:18:0.10'

  const chains: string[] = [`[1:a]aresample=48000,${VOICE_FX},volume=1.0[voice]`]
  const mixLabels = ['[voice]']
  if (bgmIdx >= 0) { chains.push(`[${bgmIdx}:a]atrim=0:${durSec.toFixed(3)},aresample=48000,volume=${bgmVol}[bgm]`); mixLabels.push('[bgm]') }
  if (gearIdx >= 0) { chains.push(`[${gearIdx}:a]aresample=48000,atrim=0:${(sfx!.openEndSec).toFixed(3)},volume=0.7[gear]`); mixLabels.push('[gear]') }
  if (dropIdx >= 0) { chains.push(`[${dropIdx}:a]aresample=48000,adelay=${Math.round(sfx!.dropAtSec * 1000)}|${Math.round(sfx!.dropAtSec * 1000)},volume=0.6[drop]`); mixLabels.push('[drop]') }

  const afilter = mixLabels.length === 1
    ? `[1:a]aresample=48000,${VOICE_FX},loudnorm=I=-14:TP=-1:LRA=7,${aformat}[a]`
    : `${chains.join(';')};${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1:LRA=7,${aformat}[a]`

  args.push(
    '-filter_complex', `${vfilter};${afilter}`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest',
    outAbs,
  )
  return args
}

export async function renderVideo(renderTaskId: string): Promise<void> {
  const renderTask = await prisma.renderTask.findUniqueOrThrow({
    where: { id: renderTaskId },
    include: { task: { include: { framework: true } }, bgm: true },
  })
  const genTaskId = renderTask.generationTaskId
  const genTask = renderTask.task
  if (!genTask.fullAudioUrl) throw new Error(`generation_task ${genTaskId} 缺少 fullAudioUrl`)

  const segments = await prisma.generatedSegment.findMany({
    where: { generationTaskId: genTaskId },
    orderBy: { seqNo: 'asc' },
  })
  if (segments.length === 0) throw new Error(`generation_task ${genTaskId} 无 generated_segments`)

  const genDir = path.join(DATA_DIR, 'gen', genTaskId)
  const bodyAbs = path.join(genDir, 'hf', 'renders', 'body.mp4')
  await fs.access(bodyAbs) // 缺 body.mp4 直接抛

  const audioAbs = urlToAbs(genTask.fullAudioUrl)
  const bgmAbs = renderTask.bgm?.fileUrl ? urlToAbs(renderTask.bgm.fileUrl) : null

  // BGM atrim 上界取 body / 配音 里较长者，保证覆盖整片
  const durSec = Math.max(probeDurationSec(bodyAbs), probeDurationSec(audioAbs), 1)

  // bodyTimings（先于 SRT 生成算出，flash 模式的 SFX 节拍也依赖它）
  const timings = Array.isArray(genTask.bodyTimings) ? (genTask.bodyTimings as unknown as Timing[]) : []
  const sortedTimings = [...timings].sort((a, b) => a.startMs - b.startMs)

  // flash 模板：把开场齿轮音 + 快闪→正文转场水滴音混进合成音轨；classic 模板不带 SFX（原行为）。
  const params = parseTemplateParams(
    (genTask.framework.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams,
  )
  let sfx: { gearAbs?: string; dropAbs?: string; openEndSec: number; dropAtSec: number } | undefined
  let bgmVolume: number | undefined
  if (params.mode === 'flash') {
    const seg0EndMs = sortedTimings[0]?.endMs ?? 0
    const books = resolveBooks(genTask.framework.overlayTemplate, genTask.variables)
    const tl = flashTimeline(params, seg0EndMs, books.length)
    const gearAbs = path.join(SFX_DIR, 'gear.mp3')
    const dropAbs = path.join(SFX_DIR, 'drop.mp3')
    // SFX 需同时满足：模板开关开启(params.audio.sfx.*) + 资源文件存在
    sfx = {
      openEndSec: tl.openEndMs / 1000,
      dropAtSec: tl.flashEndMs / 1000,
      ...(params.audio.sfx.openGear && existsSync(gearAbs) ? { gearAbs } : {}),
      ...(params.audio.sfx.transitionDrop && existsSync(dropAbs) ? { dropAbs } : {}),
    }
    bgmVolume = params.audio.bgmVolume
  }

  const outAbs = path.join(genDir, 'final.mp4')
  const args = buildFfmpegArgs({ bodyAbs, audioAbs, bgmAbs, durSec, outAbs, bgmVolume, sfx })
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', stdio: 'pipe' })
  if (r.status !== 0) {
    throw new Error(`ffmpeg 混音失败 (code ${r.status}): ${(r.stderr ?? r.stdout ?? '').slice(-800)}`)
  }

  // ffprobe 校验：720×960 且有音轨
  await fs.access(outAbs)
  const probed = probeVideo(outAbs)
  if (probed.width !== WIDTH || probed.height !== HEIGHT) {
    throw new Error(`final.mp4 尺寸异常: ${probed.width}x${probed.height}（期望 ${WIDTH}x${HEIGHT}）`)
  }
  if (!probed.hasAudio) throw new Error('final.mp4 缺少音轨')

  // 生成 SRT（bodyTimings + 各段 scriptText，按 seqNo join）
  const textBySeq = new Map(segments.map((s) => [s.seqNo, s.scriptText]))
  const srtItems = sortedTimings
    .map((t) => ({ text: textBySeq.get(t.seqNo) ?? '', startMs: t.startMs, endMs: t.endMs }))
  const srtAbs = path.join(genDir, 'subtitle.srt')
  await fs.writeFile(srtAbs, buildSrt(srtItems), 'utf8')

  const videoUrl = `/api/files/gen/${genTaskId}/final.mp4`
  const subtitleUrl = `/api/files/gen/${genTaskId}/subtitle.srt`
  await prisma.renderTask.update({ where: { id: renderTaskId }, data: { videoUrl, subtitleUrl } })

  console.log(`[gen] render-video ${renderTaskId}: final.mp4 ${probed.width}x${probed.height} +audio ok${bgmAbs ? ' (bgm)' : ''}`)

  await transitionRender(renderTaskId, 'PREVIEW_PENDING')
  if (genTask.autoRender) {
    // 学员任务：自动进质检，无需运营确认预览。
    await enqueueGen('run-gen-qc', { renderTaskId })
    console.log(`[gen] render-video ${renderTaskId}: autoRender → enqueue run-gen-qc`)
  }
  // autoRender=false：停在 PREVIEW_PENDING，等运营确认预览后由 API 触发 run-gen-qc
}
