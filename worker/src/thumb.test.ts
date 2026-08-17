import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import ffmpeg from 'fluent-ffmpeg'
import { makeThumb, thumbUrl } from './thumb'

const execFileAsync = promisify(execFile)

describe('thumbUrl（由原图 URL 推导缩略图 URL,纯函数）', () => {
  it('.png → .thumb.webp', () => {
    expect(thumbUrl('/api/files/gen/x/3.png')).toBe('/api/files/gen/x/3.thumb.webp')
  })
  it('.jpg → .thumb.webp', () => {
    expect(thumbUrl('/api/files/gen/x/3.jpg')).toBe('/api/files/gen/x/3.thumb.webp')
  })
  it('.jpeg → .thumb.webp', () => {
    expect(thumbUrl('/api/files/gen/x/3.jpeg')).toBe('/api/files/gen/x/3.thumb.webp')
  })
  it('.webp → .thumb.webp', () => {
    expect(thumbUrl('/api/files/gen/x/3.webp')).toBe('/api/files/gen/x/3.thumb.webp')
  })
  it('无扩展名时原样返回', () => {
    expect(thumbUrl('/api/files/gen/x/noext')).toBe('/api/files/gen/x/noext')
  })
  it('带查询串：先剥离 ?...再推导扩展名，再拼回查询串（不破坏 cache-busting）', () => {
    expect(thumbUrl('/api/files/gen/x/3.png?t=123')).toBe('/api/files/gen/x/3.thumb.webp?t=123')
  })
  it('查询串本身含点号也不干扰扩展名推导', () => {
    expect(thumbUrl('/api/files/gen/x/3.png?t=1699999999.123')).toBe('/api/files/gen/x/3.thumb.webp?t=1699999999.123')
  })
})

describe('makeThumb（真实调用 ffmpeg 生成 webp 缩略图）', () => {
  const tmpDir = os.tmpdir()
  let workDir: string
  let srcPng: string

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(tmpDir, 'thumb-test-'))
    srcPng = path.join(workDir, '3.png')
    // 现场用 ffmpeg CLI 生成一张 720x960 纯色 png 作为测试输入(真实图片，非伪造字节)。
    // 直接 spawn ffmpeg 而不经 fluent-ffmpeg，避免其 lavfi 设备能力探测的误判。
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=720x960',
      '-frames:v', '1', '-update', '1', srcPng,
    ])
  })

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('对真实小图产出 .thumb.webp 且文件存在、体积 > 0；原图与缩略图体积对比打印供人工核查', async () => {
    const ok = await makeThumb(srcPng)
    expect(ok).toBe(true)
    const dst = path.join(workDir, '3.thumb.webp')
    const stat = await fs.stat(dst)
    expect(stat.size).toBeGreaterThan(0)
    const srcStat = await fs.stat(srcPng)
    // eslint-disable-next-line no-console
    console.log(`[thumb.test] 原图 ${srcStat.size} bytes → 缩略图 ${stat.size} bytes`)
  })

  it('对不存在的路径 → 返回 false,不抛错', async () => {
    const ok = await makeThumb(path.join(workDir, 'does-not-exist.png'))
    expect(ok).toBe(false)
  })

  it('生成的缩略图宽度为 360（ffprobe 验证）', async () => {
    const ok = await makeThumb(srcPng)
    expect(ok).toBe(true)
    const dst = path.join(workDir, '3.thumb.webp')
    const width = await new Promise<number>((resolve, reject) => {
      ffmpeg.ffprobe(dst, (err, data) => {
        if (err) return reject(err)
        resolve(data.streams[0]?.width ?? 0)
      })
    })
    expect(width).toBe(360)
  })

  // 坏源：文件名后缀是 .png 但内容是随机字节。ffmpeg 会先打开/建立输出文件，
  // 之后解码失败才报错退出——留下一个 0 字节的 .thumb.webp。若不清理，Task 5 的
  // 网格会请求到这个 URL，得到 200+0 字节而不是 404，无法触发"回退原图"逻辑。
  it('坏源（.png 后缀但内容是随机字节）→ 返回 false 且不残留 0 字节的 .thumb.webp', async () => {
    const badSrc = path.join(workDir, 'garbage.png')
    await fs.writeFile(badSrc, Buffer.from(Array.from({ length: 2000 }, () => Math.floor(Math.random() * 256))))
    const ok = await makeThumb(badSrc)
    expect(ok).toBe(false)
    const dst = path.join(workDir, 'garbage.thumb.webp')
    const exists = await fs.stat(dst).then(() => true).catch(() => false)
    expect(exists).toBe(false)
  })
})
