// 扣子(Coze) 工作流工具箱：worker 队列消费——真正调扣子跑工作流、把输出转存到本站、
// 失败时幂等退积分。job payload 是 { runId }（见 packages/db/src/cozeQueue.ts）。
//
// 依赖全部可注入（deps），测试用假 deps 打真数据库、不打真扣子/不发真网络。
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma, cozeRunWorkflow, cozeUploadFile, parseCozeOutput, type CozeOutputItem } from '@mixcut/db'
import { DATA_DIR } from '../paths'

// 落库的展示项：在 CozeOutputItem 基础上，超限未转存的 file/image/video 项额外带一句
// 说明（note），前端可据此提示"未转存，原始链接可能已过期"。这个字段只在本文件内部使用，
// 不影响 Task 4 的 CozeOutputItem 契约（url 字段名不变）。
export type CozeStoredOutputItem = CozeOutputItem & { note?: string }

export type CozeDownloadResult = { tooLarge: true } | { buf: Buffer; contentType?: string }

export type CozeRunDeps = {
  uploadFile: (buf: Buffer, filename: string) => Promise<{ fileId: string }>
  runWorkflow: (workflowId: string, parameters: Record<string, unknown>) => Promise<{ raw: unknown }>
  download: (url: string) => Promise<CozeDownloadResult>
}

// 转存单文件体积上限：与 downloadDouyin.ts 的下载护栏一致，防止一条超大工作流输出把磁盘/内存打爆。
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'application/pdf': '.pdf', 'application/zip': '.zip',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a',
}

// 默认下载实现：先看 content-length 快速拒绝，拿不到声明大小就边读边累计字节数拦截，
// 两者都命中上限时返回 { tooLarge: true } 而不是抛错——调用方据此只跳过这一项，不炸整个 run。
async function defaultDownload(url: string): Promise<CozeDownloadResult> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`)
  const contentType = res.headers.get('content-type') ?? undefined
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) return { tooLarge: true }
  const body = res.body
  if (!body) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_DOWNLOAD_BYTES) return { tooLarge: true }
    return { buf, contentType }
  }
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel().catch(() => {})
      return { tooLarge: true }
    }
    chunks.push(Buffer.from(value))
  }
  return { buf: Buffer.concat(chunks), contentType }
}

export const defaultDeps: CozeRunDeps = {
  uploadFile: (buf, filename) => cozeUploadFile(buf, filename),
  runWorkflow: (workflowId, parameters) => cozeRunWorkflow(workflowId, parameters),
  download: defaultDownload,
}

function extFromUrl(url: string): string | null {
  try {
    const ext = path.extname(new URL(url).pathname)
    return ext || null
  } catch {
    return null
  }
}

function extFromContentType(ct?: string): string | null {
  if (!ct) return null
  const base = ct.split(';')[0].trim().toLowerCase()
  return CONTENT_TYPE_EXT[base] ?? null
}

// 把 parseCozeOutput 解析出的展示项里的 image/video/file 逐个下载转存到
// DATA_DIR/coze/<runId>/<uuid>.<ext>，原地把 url 改写为本站 /api/files/coze/<runId>/<name>。
// 超过体积上限的项保留原始（扣子远程）url，额外打上 note 说明未转存。
async function transferOutputs(items: CozeOutputItem[], runId: string, deps: CozeRunDeps): Promise<CozeStoredOutputItem[]> {
  const dir = path.join(DATA_DIR, 'coze', runId)
  const out: CozeStoredOutputItem[] = []
  for (const item of items) {
    if (item.kind === 'text') {
      out.push(item)
      continue
    }
    const result = await deps.download(item.url)
    if ('tooLarge' in result) {
      out.push({ ...item, note: `文件超过 ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB 转存上限，未转存（仍是扣子原始地址，可能会过期）` })
      continue
    }
    await fs.mkdir(dir, { recursive: true })
    const ext = extFromUrl(item.url) ?? extFromContentType(result.contentType) ?? '.bin'
    const filename = `${randomUUID()}${ext}`
    await fs.writeFile(path.join(dir, filename), result.buf)
    out.push({ ...item, url: `/api/files/coze/${runId}/${filename}` })
  }
  return out
}

// 失败收口：状态置 FAILED + 记错误信息，同一事务里幂等退积分。
// 幂等靠 updateMany({ refunded: false, creditsCost: { gt: 0 } }) 抢闸——
// 抢到（count===1）才给用户加分；重复处理同一失败 run 绝不会退第二次。
async function failRun(runId: string, userId: string, creditsCost: number, errorMsg: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.cozeToolRun.update({
      where: { id: runId },
      data: { status: 'FAILED', errorMsg: errorMsg.slice(0, 2000), finishedAt: new Date() },
    })
    const claimed = await tx.cozeToolRun.updateMany({
      where: { id: runId, refunded: false, creditsCost: { gt: 0 } },
      data: { refunded: true },
    })
    if (claimed.count === 1) {
      await tx.user.update({ where: { id: userId }, data: { credits: { increment: creditsCost } } })
    }
  })
}

type DeclaredInput = { name: string; type?: string }

export async function processCozeRun(runId: string, deps: CozeRunDeps = defaultDeps): Promise<void> {
  const run = await prisma.cozeToolRun.findUnique({ where: { id: runId } })
  if (!run) {
    // job 里的 runId 在库里已经找不到（脏 job / 手工删过），warn 即可，不能让整个 worker 炸掉。
    console.warn(`[coze] run 不存在，跳过: ${runId}`)
    return
  }

  await prisma.cozeToolRun.update({ where: { id: runId }, data: { status: 'RUNNING' } })

  const tool = await prisma.cozeTool.findUnique({ where: { id: run.toolId } })
  if (!tool) {
    await failRun(runId, run.userId, run.creditsCost, '工具已被删除')
    return
  }

  try {
    const declared = Array.isArray(tool.inputs) ? (tool.inputs as unknown as DeclaredInput[]) : []
    const submitted = run.inputs && typeof run.inputs === 'object' ? (run.inputs as Record<string, unknown>) : {}
    const parameters: Record<string, unknown> = { ...submitted }

    // image 字段：学员提交时存的是 DATA_DIR 下的相对路径（coze-uploads/<uuid>.<ext>，
    // web 侧已校验过合法性）。读文件 → 换成扣子 fileId → 写回参数。
    for (const field of declared) {
      if (field.type !== 'image') continue
      const rel = submitted[field.name]
      if (typeof rel !== 'string' || !rel) continue
      const buf = await fs.readFile(path.join(DATA_DIR, rel))
      const { fileId } = await deps.uploadFile(buf, path.basename(rel))
      // 扣子图片参数的引用格式：spike 未做，按扣子公开文档预写为 { file_id } 的 JSON 字符串。
      // 若与实测不符，以实测为准，届时只需改这一行。
      parameters[field.name] = JSON.stringify({ file_id: fileId })
    }

    const { raw } = await deps.runWorkflow(tool.workflowId, parameters)
    const outputItems = await transferOutputs(parseCozeOutput(raw), runId, deps)

    await prisma.cozeToolRun.update({
      where: { id: runId },
      data: {
        status: 'SUCCEEDED',
        outputRaw: (raw ?? null) as Prisma.InputJsonValue,
        outputItems: outputItems as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[coze] run ${runId} 失败: ${msg}`)
    await failRun(runId, run.userId, run.creditsCost, msg)
  }
}
