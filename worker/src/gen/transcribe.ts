import path from 'path'
import { prisma, asrTranscribe, setSourceStatus, enqueueGen, publicAssetUrl } from '@mixcut/db'
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
    const wavRelPath = path.join('source', `${sourceVideoId}.wav`)
    const wavPath = path.join(DATA_DIR, wavRelPath)
    await extractAudio(videoAbs, wavPath)

    // ASR（真实 DashScope 调用）需要 DashScope 可达的公网 URL；本地 mock 分支不会真正请求该 URL。
    const audioUrl = publicAssetUrl(wavRelPath)
    const r = await asrTranscribe({ audioUrl })
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
