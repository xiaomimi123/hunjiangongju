// 缩略图缺失时的处理：**按需补生成一次**，而不是每次都回退原图。
//
// ── 上一版为什么不行（我自己引入的性能回归）──
//
// 上一版是「缺缩略图 → 直接返回原图」。理由是「慢一点好过裂图」，但没算清代价：
// 素材库一屏几十张图全都缺缩略图时，原先是 N 次快速 404，变成了 N 次**全尺寸原图下载**
// ——几十 MB 的传输量，而且每张还要多跑最多 4 次同步 fs 探测。
// web 是单进程 Node，同步 fs 会独占 event loop，后台其他页面的 SSR 请求全部排在后面
// ——这就是「素材库一慢，点别的菜单也慢」的由来。
//
// 而且那是个**不会自愈**的稳态：只要缩略图没补上，每次打开素材库都重传一遍原图。
//
// ── 现在的做法 ──
//
// web 容器里有 ffmpeg（见 web/Dockerfile），所以缺缩略图时补生成一次，之后永久命中。
// 生成失败（图损坏、格式不支持）才退回原图——那种情况本来也没别的办法。
// fs 一律用异步，不再阻塞 event loop。

import fsp from 'fs/promises'

/** 缩略图后缀。与 thumbUrl() 保持一致，改这里必须同步改那边。 */
export const THUMB_SUFFIX = '.thumb.webp'

/** 可能的原图扩展名。缩略图名里看不出原图是什么格式，只能逐个试。 */
const ORIGINAL_EXTS = ['.png', '.jpg', '.jpeg', '.webp']

export async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fsp.stat(abs)).isFile()
  } catch {
    return false
  }
}

/**
 * 请求的是缩略图但它不存在时，找出可以顶上的原图。
 *
 * **只对 `.thumb.webp` 生效**：普通文件缺失必须照常 404，
 * 绝不能悄悄换成一个同名不同扩展名的文件返回。
 */
export async function findOriginal(rel: string, resolve: (r: string) => string | null): Promise<string | null> {
  if (!rel.endsWith(THUMB_SUFFIX)) return null
  const base = rel.slice(0, -THUMB_SUFFIX.length)
  if (!base) return null
  for (const ext of ORIGINAL_EXTS) {
    const abs = resolve(base + ext)
    if (abs && (await isFile(abs))) return abs
  }
  return null
}

/**
 * 同一张图并发请求时只生成一次。
 *
 * 素材库一屏几十张图会同时打过来；不去重的话同一个文件可能被 ffmpeg 同时转好几次，
 * 既浪费 CPU 又可能互相覆盖到半截文件。
 */
const inFlight = new Map<string, Promise<boolean>>()

/**
 * 同时最多跑这么多个 ffmpeg。
 *
 * 素材库首次打开时一屏几十张图会同时缺缩略图。不限并发的话就是几十个 ffmpeg 进程
 * 一起起来，那一下比不补生成还卡——而 web 是单进程 Node，CPU 被抢光时连别的页面
 * 都打不开。限流后是"排队补齐"：每张图慢一点，但整个后台始终可用。
 */
const MAX_CONCURRENT = 2
let running = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) { running++; return }
  await new Promise<void>((resolve) => waiting.push(resolve))
  running++
}
function release(): void {
  running--
  waiting.shift()?.()
}

export function generateOnce(srcAbs: string, make: (abs: string) => Promise<boolean>): Promise<boolean> {
  const dup = inFlight.get(srcAbs)
  if (dup) return dup
  const p = (async () => {
    await acquire()
    try { return await make(srcAbs) } finally { release() }
  })().finally(() => inFlight.delete(srcAbs))
  inFlight.set(srcAbs, p)
  return p
}
