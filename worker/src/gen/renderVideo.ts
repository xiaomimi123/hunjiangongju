import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma, transitionRender, buildSrt } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'

const WIDTH = 720
const HEIGHT = 960

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

/** 构造 ffmpeg 参数：body 视觉 + 整篇配音（+可选 BGM）+ loudnorm，输出 final.mp4 */
export function buildFfmpegArgs(opts: {
  bodyAbs: string
  audioAbs: string
  bgmAbs: string | null
  durSec: number
  outAbs: string
}): string[] {
  const { bodyAbs, audioAbs, bgmAbs, durSec, outAbs } = opts
  const args = ['-y', '-i', bodyAbs, '-i', audioAbs]
  if (bgmAbs) args.push('-stream_loop', '-1', '-i', bgmAbs)

  const aformat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
  const filter = bgmAbs
    ? [
        '[1:a]aresample=48000,volume=1.0[voice]',
        `[2:a]atrim=0:${durSec.toFixed(3)},aresample=48000,volume=0.32[bgm]`,
        `[voice][bgm]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1:LRA=7,${aformat}[a]`,
      ].join(';')
    : `[1:a]aresample=48000,loudnorm=I=-14:TP=-1:LRA=7,${aformat}[a]`

  args.push(
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[a]',
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
    include: { task: true, bgm: true },
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

  const outAbs = path.join(genDir, 'final.mp4')
  const args = buildFfmpegArgs({ bodyAbs, audioAbs, bgmAbs, durSec, outAbs })
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
  const timings = Array.isArray(genTask.bodyTimings) ? (genTask.bodyTimings as unknown as Timing[]) : []
  const textBySeq = new Map(segments.map((s) => [s.seqNo, s.scriptText]))
  const srtItems = [...timings]
    .sort((a, b) => a.startMs - b.startMs)
    .map((t) => ({ text: textBySeq.get(t.seqNo) ?? '', startMs: t.startMs, endMs: t.endMs }))
  const srtAbs = path.join(genDir, 'subtitle.srt')
  await fs.writeFile(srtAbs, buildSrt(srtItems), 'utf8')

  const videoUrl = `/api/files/gen/${genTaskId}/final.mp4`
  const subtitleUrl = `/api/files/gen/${genTaskId}/subtitle.srt`
  await prisma.renderTask.update({ where: { id: renderTaskId }, data: { videoUrl, subtitleUrl } })

  console.log(`[gen] render-video ${renderTaskId}: final.mp4 ${probed.width}x${probed.height} +audio ok${bgmAbs ? ' (bgm)' : ''}`)

  // 不自动跑 QC，等运营确认预览后由 API 触发 run-gen-qc
  await transitionRender(renderTaskId, 'PREVIEW_PENDING')
}
