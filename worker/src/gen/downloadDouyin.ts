import { promises as fs } from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { prisma, setSourceStatus, enqueueGen } from '@mixcut/db'
import { DATA_DIR } from '../paths'

const FAIL_NOTE = '链接解析失败，请改用手动上传'
const NOT_DOUYIN_NOTE = '仅支持抖音分享链接，请改用手动上传'

// 网络护栏：解析/跳转短超时；下载有界超时；下载体积上限（防挂起 & OOM）
const RESOLVE_TIMEOUT_MS = 8_000
const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024 // 200 MB 上限

// SSRF 白名单：仅允许抖音域名，杜绝 169.254.169.254 / localhost 等内网探测
const DOUYIN_HOSTS = new Set(['v.douyin.com', 'www.douyin.com', 'douyin.com', 'iesdouyin.com'])
function isDouyinHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return DOUYIN_HOSTS.has(h) || h.endsWith('.douyin.com') || h.endsWith('.iesdouyin.com')
}

/** fetch + AbortController 超时；返回 res 与 done()（清理定时器，务必在 finally 调用） */
async function timedFetch(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<{ res: Response; done: () => void }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    return { res, done: () => clearTimeout(timer) }
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

/** 读取响应体，硬上限：先查 content-length，再流式累计字节数，超限即中断（防 OOM） */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`下载体积超限(content-length ${declared}B > ${maxBytes}B)`)
  }
  const body = res.body
  if (!body) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) throw new Error(`下载体积超限(${buf.length}B > ${maxBytes}B)`)
    return buf
  }
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error(`下载体积超限(>${maxBytes}B)`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

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

    // 1.5 SSRF 闸门：任何网络请求之前先校验 host 属于抖音白名单
    //     非抖音（含内网元数据地址）直接拒绝，绝不发起 fetch
    let entryHost: string
    try {
      entryHost = new URL(entryUrl).hostname
    } catch {
      throw new Error(NOT_DOUYIN_NOTE)
    }
    if (!isDouyinHost(entryHost)) throw new Error(NOT_DOUYIN_NOTE)

    // 2. 跟随跳转拿最终 URL，从中抽数字 video id（8s 超时，防挂起冻结队列）
    const { res: resolved, done: doneResolve } = await timedFetch(entryUrl, RESOLVE_TIMEOUT_MS, {
      redirect: 'follow',
    })
    doneResolve()
    const finalUrl = resolved.url || entryUrl
    const idMatch =
      finalUrl.match(/\/video\/(\d+)/) ||
      finalUrl.match(/[?&](?:video_id|item_ids|modal_id)=(\d+)/)
    const videoId = idMatch?.[1]
    if (!videoId) throw new Error(`未能从链接解析出 video id: ${finalUrl}`)

    // 3. 构造已知无水印直链 pattern 拉取 mp4 字节（30s 超时 + 200MB 上限，防挂起/OOM）
    const playUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`
    const { res: dl, done: doneDl } = await timedFetch(playUrl, DOWNLOAD_TIMEOUT_MS, {
      redirect: 'follow',
    })
    let bytes: Buffer
    try {
      if (!dl.ok) throw new Error(`直链下载失败: HTTP ${dl.status}`)
      bytes = await readCapped(dl, MAX_DOWNLOAD_BYTES)
    } finally {
      doneDl()
    }

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
