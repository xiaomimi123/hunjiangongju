import { prisma, parseSceneCuts, setSourceStatus, enqueueGen } from '@mixcut/db'
import { urlToAbs } from '../paths'
import { detectScenes } from '../ffmpeg'

/** ffmpeg 场景检测 → 解析切点 → 写 SceneCut → 进入框架提炼 */
export async function detectScenesJob(sourceVideoId: string): Promise<void> {
  const source = await prisma.sourceVideo.findUnique({ where: { id: sourceVideoId } })
  if (!source?.videoFileUrl) throw new Error(`SourceVideo ${sourceVideoId} 缺少 videoFileUrl`)

  const videoAbs = urlToAbs(source.videoFileUrl)
  const output = await detectScenes(videoAbs)
  const cutPointsMs = parseSceneCuts(output)

  await prisma.sceneCut.create({ data: { sourceVideoId, cutPointsMs } })

  await setSourceStatus(sourceVideoId, 'FRAMEWORK_EXTRACTING')
  await enqueueGen('extract-framework', { sourceVideoId })
}
