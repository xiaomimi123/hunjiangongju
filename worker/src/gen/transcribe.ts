import path from 'path'
import { prisma, asrTranscribe, setSourceStatus, enqueueGen } from '@mixcut/db'
import { DATA_DIR, urlToAbs } from '../paths'
import { extractAudio } from '../ffmpeg'

/** 抽音频 → ASR 转写 → 写 Transcript → 进入场景检测 */
export async function transcribe(sourceVideoId: string): Promise<void> {
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
}
