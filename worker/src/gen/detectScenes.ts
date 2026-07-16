import { prisma, parseSceneCuts, setSourceStatus, enqueueGen } from '@mixcut/db'
import { urlToAbs } from '../paths'
import { detectScenes } from '../ffmpeg'

/** 单个拆解 job 的墙钟保护，避免真 ffmpeg 卡死占满并发 */
const DETECT_SCENES_TIMEOUT_MS = 180000

/** ffmpeg 场景检测 → 解析切点 → 写 SceneCut → 进入框架提炼 */
export async function detectScenesJob(sourceVideoId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = (async () => {
    const source = await prisma.sourceVideo.findUnique({ where: { id: sourceVideoId } })
    if (!source?.videoFileUrl) throw new Error(`SourceVideo ${sourceVideoId} 缺少 videoFileUrl`)

    const videoAbs = urlToAbs(source.videoFileUrl)
    const output = await detectScenes(videoAbs)
    const cutPointsMs = parseSceneCuts(output)

    await prisma.sceneCut.create({ data: { sourceVideoId, cutPointsMs } })

    await setSourceStatus(sourceVideoId, 'FRAMEWORK_EXTRACTING')
    await enqueueGen('extract-framework', { sourceVideoId })
  })()
  try {
    await Promise.race([
      work,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('detect-scenes 超时')), DETECT_SCENES_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
