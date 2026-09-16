// AI 实拍生图：worker 队列消费——内页先视觉分类，拼素材包提示词，调生图服务（异步任务
// 提交+轮询在 photoGenerate 内部完成），把临时 URL 的成品转存本地，失败幂等退分。
// 状态闸 + 退分闸的写法逐行对齐 worker/src/coze/run.ts。
//
// 依赖全部可注入（deps）：测试打真数据库、不发真网络。
import { promises as fs } from 'fs'
import path from 'path'
import {
  prisma, photoGenerate, isMockPhotoUrl, mockPhotoBytes, publicAssetUrl,
  buildCoverPrompt, buildInnerPrompt, classifyInnerPage,
  type CoverShotMode, type InnerStyle, type InnerPageInfo,
} from '@mixcut/db'
import { DATA_DIR } from '../paths'

export type PhotoRunDeps = {
  /** 一次生成一张，返回远程（或 mock:）URL 列表 */
  generate: (opts: { prompt: string; images: string[]; size: string }) => Promise<string[]>
  /** 内页照片 → 标题/左右页/标题位置 */
  classify: (imageUrl: string) => Promise<InnerPageInfo>
  download: (url: string) => Promise<Buffer>
}

// 学员上传原图的白名单：必须与 web/lib/photoInputs.ts 的 INPUT_REL_RE 一致（纵深防御第二道闸）
const INPUT_REL_RE = /^photo-uploads\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/

const NON_TERMINAL_STATUSES = ['QUEUED', 'RUNNING']

// 参考图目录：素材包里复制进仓库的姿态/光线参考（packages/db/assets/photo-gen/refs/）。
// 不能用 process.cwd() 定位——npm workspace 启动时 cwd 是 worker/ 而非仓库根
// （本地 smoke 与 docker 的 `npm run start -w worker` 都如此），从 @mixcut/db 包自身反解最稳。
const REFS_DIR = path.join(
  path.dirname(require.resolve('@mixcut/db/package.json')),
  'assets/photo-gen/refs',
)

async function defaultDownload(url: string): Promise<Buffer> {
  if (isMockPhotoUrl(url)) return mockPhotoBytes()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`成品下载失败 ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export const defaultDeps: PhotoRunDeps = {
  generate: (opts) => photoGenerate(opts),
  classify: (imageUrl) => classifyInnerPage(imageUrl),
  download: defaultDownload,
}

async function toDataUri(abs: string): Promise<string> {
  const buf = await fs.readFile(abs)
  const ext = path.extname(abs).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function failRun(runId: string, userId: string, creditsCost: number, errorMsg: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const claimedFail = await tx.photoGenRun.updateMany({
      where: { id: runId, status: { in: NON_TERMINAL_STATUSES } },
      data: { status: 'FAILED', errorMsg: errorMsg.slice(0, 2000), finishedAt: new Date() },
    })
    if (claimedFail.count === 0) return
    const claimedRefund = await tx.photoGenRun.updateMany({
      where: { id: runId, refunded: false, creditsCost: { gt: 0 } },
      data: { refunded: true },
    })
    if (claimedRefund.count === 1) {
      await tx.user.updateMany({ where: { id: userId }, data: { credits: { increment: creditsCost } } })
    }
  })
}

export async function recoverFailedPhotoRun(runId: string, errorMsg: string): Promise<void> {
  const run = await prisma.photoGenRun.findUnique({ where: { id: runId } })
  if (!run) return
  await failRun(runId, run.userId, run.creditsCost, errorMsg)
}

export async function processPhotoRun(runId: string, deps: PhotoRunDeps = defaultDeps): Promise<void> {
  const run = await prisma.photoGenRun.findUnique({ where: { id: runId } })
  if (!run) { console.warn(`[photo] run ${runId} 不存在，跳过`); return }

  const claimedRunning = await prisma.photoGenRun.updateMany({
    where: { id: runId, status: 'QUEUED' },
    data: { status: 'RUNNING' },
  })
  if (claimedRunning.count === 0) {
    console.warn(`[photo] run ${runId} 已被消费（重复投递），跳过`)
    return
  }

  try {
    if (!INPUT_REL_RE.test(run.inputImage)) throw new Error(`原图路径不合法：${run.inputImage}`)
    const inputAbs = path.join(DATA_DIR, run.inputImage)
    const inputUri = await toDataUri(inputAbs)

    let prompt: string
    let images: string[]
    let size: string
    if (run.mode === 'cover') {
      const { prompt: p, ref } = buildCoverPrompt((run.shotMode ?? 'auto') as CoverShotMode)
      prompt = p
      images = [inputUri, await toDataUri(path.join(REFS_DIR, ref))]
      size = '4:5'
    } else {
      // 内页：先视觉识别标题与版位。识别要公网 URL（百炼要自己来拉）——
      // 签 1 小时短时效足够 vision 一次调用。
      const info = await deps.classify(publicAssetUrl(run.inputImage))
      prompt = buildInnerPrompt({
        title: info.title, pageSide: info.pageSide, titleBand: info.titleBand,
        style: (run.style ?? 'S01') as InnerStyle,
      })
      images = [inputUri]
      size = '3:4'
    }

    // 每张一个独立任务并行跑；单张失败不拖垮整个 run（部分成功=成功+按张退分）
    const results = await Promise.allSettled(
      Array.from({ length: run.count }, () => deps.generate({ prompt, images, size })),
    )

    const dir = path.join(DATA_DIR, 'photo-gen', runId)
    await fs.mkdir(dir, { recursive: true })
    const saved: { url: string }[] = []
    let lastError = ''
    let idx = 0
    for (const r of results) {
      if (r.status === 'rejected') { lastError = (r.reason as Error)?.message ?? String(r.reason); continue }
      for (const remoteUrl of r.value) {
        try {
          const buf = await deps.download(remoteUrl)
          idx += 1
          const rel = `photo-gen/${runId}/${idx}.png`
          await fs.writeFile(path.join(DATA_DIR, rel), buf)
          saved.push({ url: rel })
        } catch (e) {
          lastError = (e as Error).message
        }
      }
    }

    if (saved.length === 0) {
      throw new Error(lastError ? `生成失败：${lastError}` : '生成失败：没有得到任何图片')
    }

    // 部分成功：按未产出的张数退分。单价 = creditsCost / count（建 run 时按张定价整数相乘，能整除）
    const failedCount = run.count - saved.length
    const perImage = run.count > 0 ? Math.floor(run.creditsCost / run.count) : 0
    const refundAmount = failedCount > 0 ? failedCount * perImage : 0

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.photoGenRun.updateMany({
        where: { id: runId, status: 'RUNNING' },
        data: {
          status: 'SUCCEEDED',
          outputImages: saved,
          creditsCost: run.creditsCost - refundAmount,
          errorMsg: failedCount > 0 ? `有 ${failedCount} 张生成失败，对应积分已退回` : null,
          finishedAt: new Date(),
        },
      })
      if (claimed.count === 1 && refundAmount > 0) {
        await tx.user.updateMany({ where: { id: run.userId }, data: { credits: { increment: refundAmount } } })
      }
    })
  } catch (err) {
    await failRun(runId, run.userId, run.creditsCost, (err as Error).message ?? '未知错误')
  }
}
