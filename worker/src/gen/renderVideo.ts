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

/** 水滴音有效长度（秒）。客户样例草稿把 1.595s 的素材截到 0.530s，只取起手那一声。 */
const DROP_LEN_SEC = 0.53

/** 构造 ffmpeg 参数：body 视觉 + 整篇配音（+可选 BGM/SFX）+ loudnorm，输出 final.mp4 */
export function buildFfmpegArgs(opts: {
  bodyAbs: string
  audioAbs: string
  bgmAbs: string | null
  durSec: number
  outAbs: string
  bgmVolume?: number
  sfx?: { gearAbs?: string; dropAbs?: string; openEndSec: number; flashEndSec: number; dropAtSec: number }
}): string[] {
  const { bodyAbs, audioAbs, bgmAbs, durSec, outAbs, sfx } = opts
  const bgmVol = typeof opts.bgmVolume === 'number' ? opts.bgmVolume : 0.32
  const args = ['-y', '-i', bodyAbs, '-i', audioAbs]
  let idx = 2
  let bgmIdx = -1, gearIdx = -1, dropIdx = -1
  // 快闪窗口 = [开场结束, 快闪结束]，齿轮音铺满它。窗口非法（时长 <= 0）时整条不混入——
  // 负时长会让 ffmpeg 的 atrim 直接产出空流，混进 amix 后是一路静音输入，排查起来毫无线索。
  const gearLenSec = sfx ? sfx.flashEndSec - sfx.openEndSec : 0
  const gearOk = !!sfx?.gearAbs && gearLenSec > 0
  if (bgmAbs) { args.push('-stream_loop', '-1', '-i', bgmAbs); bgmIdx = idx++ }
  if (gearOk) { args.push('-i', sfx!.gearAbs!); gearIdx = idx++ }
  if (sfx?.dropAbs) { args.push('-i', sfx.dropAbs); dropIdx = idx++ }

  // 【不要再加 zoompan】原本这里有一句 zoompan 做「前 1.1s 从 1.12x 拉回 1.0」的开场推近。
  // 它在服务器的 ffmpeg 5.1.9 上会**把画面冻住**：实测拿真 body.mp4 隔离验证，
  // 过 zoompan 后 t=3/8/10 三个帧指纹完全相同，不过则四个全不同。
  // 本机 ffmpeg 9.0.1 复现不出来——是老版 zoompan 在 d=1 时不逐帧取新输入的行为，新版已修。
  // 症状是每条成片从约 2 秒起画面定格、字幕整条消失（字幕本身在 HTML 和 body.mp4 里都是好的，
  // 只是被定格在了一个还没有字幕的时刻）。
  //
  // 那个推近本来也是我们自己加的装饰，客户工程里没有这一下；开场动效已由 HTML 的碎裂层负责，
  // 去掉它反而更贴近「照抄工程文件」。scale 补上原先由 zoompan 的 s= 参数兜着的尺寸保证。
  const vfilter = '[0:v]scale=720:960,fade=t=in:st=0:d=0.7,format=yuv420p[v]'

  const aformat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
  // 人声后处理：把偏平的 TTS/克隆音色处理得更自然、厚实、有磁性——
  // 去低频隆隆(highpass) + 暖色/胸腔感(250Hz+) + 临场清晰(3.2k+) + 柔化齿音毛刺(7.2k-) +
  // 动态压缩(声音更稳更"贴脸") + 极轻空间反射(故事感)。
  const VOICE_FX =
    'highpass=f=85,equalizer=f=250:width_type=q:w=1.2:g=2.5,equalizer=f=3200:width_type=q:w=1.6:g=1.5,equalizer=f=7200:width_type=q:w=2:g=-3.5,acompressor=threshold=-18dB:ratio=3:attack=20:release=200:makeup=2,aecho=0.9:0.85:18:0.10'

  const chains: string[] = [`[1:a]aresample=48000,${VOICE_FX},volume=1.0[voice]`]
  const mixLabels = ['[voice]']
  if (bgmIdx >= 0) { chains.push(`[${bgmIdx}:a]atrim=0:${durSec.toFixed(3)},aresample=48000,volume=${bgmVol}[bgm]`); mixLabels.push('[bgm]') }
  // 齿轮音：起点 = 开场结束，长度 = 快闪段时长。
  // 原实现是 `atrim=0:openEndSec` 且不加 adelay —— 把「开场结束的时间点」当成了「时长」，
  // 结果从 0 秒起播、整段盖在开场上，开场一结束就断。实测客户样例草稿是 2.159s→3.983s，
  // 即**正好铺满 9 张书封的快闪轮播**，与开场无关。
  if (gearIdx >= 0) {
    const gearMs = Math.round(sfx!.openEndSec * 1000)
    chains.push(
      `[${gearIdx}:a]aresample=48000,atrim=0:${gearLenSec.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `adelay=${gearMs}|${gearMs},volume=0.7[gear]`,
    )
    mixLabels.push('[gear]')
  }
  // 水滴音：草稿把 1.595s 的素材只用了 0.530s（截断，不留尾音），音量 0.51（约为齿轮的一半）。
  // 不截断会让水声一直拖进正片第一句台词。
  if (dropIdx >= 0) {
    const dropMs = Math.round(sfx!.dropAtSec * 1000)
    chains.push(
      `[${dropIdx}:a]aresample=48000,atrim=0:${DROP_LEN_SEC.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `adelay=${dropMs}|${dropMs},volume=0.36[drop]`,
    )
    mixLabels.push('[drop]')
  }

  const afilter = mixLabels.length === 1
    ? `[1:a]aresample=48000,${VOICE_FX},loudnorm=I=-14:TP=-1:LRA=7,${aformat}[a]`
    : `${chains.join(';')};${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1:LRA=7,${aformat}[a]`

  args.push(
    '-filter_complex', `${vfilter};${afilter}`,
    '-map', '[v]', '-map', '[a]',
    // crf 24 而不是 28：**28 会把慢速运镜量化掉**。
    // 推近很慢时每帧位移不到 1 像素，x264 在 crf 28 下把这点残差编成 skip 块——
    // 实测同一条片子连续两帧完全不动、再靠一次刷新补回来，肉眼就是卡顿。
    //   crf 28: 卡住 4/35 帧，1.8MB
    //   crf 24: 卡住 0/35 帧，3.5MB
    // 23 秒竖屏片多出 1.7MB，换掉一个肉眼可见的卡顿，划算。
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
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

  // flash 模板：把快闪段齿轮音 + 快闪→正文转场水滴音混进合成音轨；classic 模板不带 SFX（原行为）。
  const params = parseTemplateParams(
    (genTask.framework.overlayTemplate as { __templateParams?: unknown } | null)?.__templateParams,
  )
  let sfx: { gearAbs?: string; dropAbs?: string; openEndSec: number; flashEndSec: number; dropAtSec: number } | undefined
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
      flashEndSec: tl.flashEndMs / 1000,
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
