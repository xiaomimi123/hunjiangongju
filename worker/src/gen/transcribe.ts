import path from 'path'
import { prisma, asrTranscribe, setSourceStatus, enqueueGen } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { extractAudio } from '../ffmpeg'

/** 单个拆解 job 的墙钟保护，避免真 ASR 卡死占满并发 */
const TRANSCRIBE_TIMEOUT_MS = 180000

/** 抽音频 → ASR 转写 → 写 Transcript → 进入场景检测 */
export async function transcribe(sourceVideoId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = (async () => {
    const source = await prisma.sourceVideo.findUnique({ where: { id: sourceVideoId } })
    if (!source?.videoFileUrl) throw new Error(`SourceVideo ${sourceVideoId} 缺少 videoFileUrl`)

    const videoAbs = urlToAbs(source.videoFileUrl)
    const wavPath = path.join(DATA_DIR, 'source', `${sourceVideoId}.wav`)
    await extractAudio(videoAbs, wavPath)

    const r = await asrTranscribe({ audioPath: wavPath })
    await prisma.transcript.create({
      data: { sourceVideoId, fullText: r.fullText, sentences: r.sentences },
    })

    await setSourceStatus(sourceVideoId, 'SCENE_DETECTING')
    await enqueueGen('detect-scenes', { sourceVideoId })
  })()
  try {
    await Promise.race([
      work,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('transcribe 超时')), TRANSCRIBE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
