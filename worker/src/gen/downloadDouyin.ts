import { promises as fs } from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { prisma, setSourceStatus, enqueueGen } from '@mixcut/db'
import { DATA_DIR } from '../paths'

const FAIL_NOTE = '链接解析失败，请改用手动上传'

/** ffprobe：文件是否含视频流 */
function probeHasVideo(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) return resolve(false)
      resolve((data.streams ?? []).some((s) => s.codec_type === 'video'))
    })
  })
}

/**
 * best-effort 解析抖音分享链 → 无水印直链 → 下载到 /data/source/<id>.mp4。
 * 抖音风控多变，此为兜底路径；可靠主路径是手动上传（extract/upload）。
 * 任一步失败：置 SourceVideo FAILED + 记录原因 + 抛错（worker 记录日志，不 crash）。
 */
export async function downloadDouyin(sourceVideoId: string): Promise<void> {
  await setSourceStatus(sourceVideoId, 'DOWNLOADING')

  const source = await prisma.sourceVideo.findUniqueOrThrow({
    where: { id: sourceVideoId },
    select: { douyinShareUrl: true },
  })

  const rel = `source/${sourceVideoId}.mp4`
  const abs = path.join(DATA_DIR, rel)

  try {
    // 1. 从分享文案里抽出短链（用户常粘一整段带文字的分享文本）
    const shortMatch = source.douyinShareUrl.match(/https?:\/\/v\.douyin\.com\/\S+/)
    const entryUrl = (shortMatch?.[0] ?? source.douyinShareUrl).replace(/[\s，。、]+$/, '')

    // 2. 跟随跳转拿最终 URL，从中抽数字 video id
    const resolved = await fetch(entryUrl, { redirect: 'follow' })
    const finalUrl = resolved.url || entryUrl
    const idMatch =
      finalUrl.match(/\/video\/(\d+)/) ||
      finalUrl.match(/[?&](?:video_id|item_ids|modal_id)=(\d+)/)
    const videoId = idMatch?.[1]
    if (!videoId) throw new Error(`未能从链接解析出 video id: ${finalUrl}`)

    // 3. 构造已知无水印直链 pattern 拉取 mp4 字节
    const playUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`
    const dl = await fetch(playUrl, { redirect: 'follow' })
    if (!dl.ok) throw new Error(`直链下载失败: HTTP ${dl.status}`)
    const bytes = Buffer.from(await dl.arrayBuffer())

    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, bytes)

    // 4. 校验确实是可用视频（体积 + ffprobe 有视频流）
    if (bytes.length < 100 * 1024) throw new Error(`下载内容过小(${bytes.length}B)，疑似非视频`)
    if (!(await probeHasVideo(abs))) throw new Error('ffprobe 未检出视频流')
  } catch (err) {
    await fs.rm(abs, { force: true }).catch(() => {})
    console.error(`[download-douyin] ${sourceVideoId} ${FAIL_NOTE}:`, (err as Error).message)
    await setSourceStatus(sourceVideoId, 'FAILED').catch(() => {})
    throw new Error(FAIL_NOTE)
  }

  await prisma.sourceVideo.update({
    where: { id: sourceVideoId },
    data: { videoFileUrl: `/api/files/${rel}` },
  })
  await setSourceStatus(sourceVideoId, 'TRANSCRIBING')
  await enqueueGen('transcribe', { sourceVideoId })
}
