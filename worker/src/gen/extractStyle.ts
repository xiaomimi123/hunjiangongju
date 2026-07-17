import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { publicAssetUrl, describeImageStyle, MOCK_VISION_STYLE, type VisionStyleResult } from '@mixcut/db'
import { DATA_DIR } from '../paths'

// 抽 3~5 帧做画风识别；帧数不影响识别质量太多，取中间值 4 帧
const FRAME_COUNT = 4

function probeDurationSec(mediaAbs: string): number {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mediaAbs],
    { encoding: 'utf8' },
  )
  const sec = parseFloat((r.stdout ?? '').trim())
  return Number.isFinite(sec) && sec > 0 ? sec : 0
}

/**
 * 从源视频均匀抽 3~5 帧 → 写入 /data/source/<id>-frames/ → publicAssetUrl 签名 →
 * 调 describeImageStyle 识别源视频画风。
 * mock 模式下 describeImageStyle 内部直接返回固定 mock 值；ffmpeg/网络任何一步失败都
 * 兜底返回 mock 默认值，绝不向上抛错（拆解流程不能因画风识别失败而中断）。
 */
export async function extractStyleFromVideo(sourceVideoId: string, videoAbs: string): Promise<VisionStyleResult> {
  try {
    const framesDir = path.join(DATA_DIR, 'source', `${sourceVideoId}-frames`)
    await fs.mkdir(framesDir, { recursive: true })

    const durSec = probeDurationSec(videoAbs)
    const relPaths: string[] = []
    for (let i = 0; i < FRAME_COUNT; i++) {
      // 均匀分布在视频时长内（避开首尾），时长探测失败时退化为每秒一帧
      const t = durSec > 0 ? (durSec * (i + 1)) / (FRAME_COUNT + 1) : i + 0.5
      const fileName = `frame-${i}.jpg`
      const outAbs = path.join(framesDir, fileName)
      const r = spawnSync(
        'ffmpeg',
        ['-y', '-ss', t.toFixed(2), '-i', videoAbs, '-frames:v', '1', '-q:v', '4', outAbs],
        { encoding: 'utf8', stdio: 'pipe' },
      )
      if (r.status !== 0) continue // 单帧失败跳过，凑够剩余帧即可
      relPaths.push(path.join('source', `${sourceVideoId}-frames`, fileName))
    }
    if (relPaths.length === 0) return MOCK_VISION_STYLE

    const imageUrls = relPaths.map((rel) => publicAssetUrl(rel))
    return await describeImageStyle(imageUrls)
  } catch {
    return MOCK_VISION_STYLE
  }
}
