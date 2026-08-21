import { describe, it, expect } from 'vitest'
import { findOriginal, generateOnce, THUMB_SUFFIX } from './thumbFallback'
import fsp from 'fs/promises'
import path from 'path'
import os from 'os'

describe('findOriginal', () => {
  it('缩略图缺失时按扩展名依次找出原图', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'thumbfb-'))
    try {
      await fsp.writeFile(path.join(dir, 'a.png'), 'x')
      await fsp.writeFile(path.join(dir, 'b.jpg'), 'x')
      const resolve = (r: string) => path.join(dir, r)
      expect(await findOriginal(`a${THUMB_SUFFIX}`, resolve)).toBe(path.join(dir, 'a.png'))
      expect(await findOriginal(`b${THUMB_SUFFIX}`, resolve)).toBe(path.join(dir, 'b.jpg'))
      expect(await findOriginal(`c${THUMB_SUFFIX}`, resolve)).toBeNull()
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  // 不是缩略图请求就别管：普通文件缺失该照常 404，不能悄悄换成别的文件
  it('非缩略图请求一律不兜底', async () => {
    const resolve = (r: string) => `/tmp/${r}`
    expect(await findOriginal('assets/abc.png', resolve)).toBeNull()
    expect(await findOriginal('gen/x/full.mp4', resolve)).toBeNull()
  })

  it('空基名不兜底', async () => {
    expect(await findOriginal(THUMB_SUFFIX, (r) => `/tmp/${r}`)).toBeNull()
  })

  // 根目录校验不通过时 resolve 返回 null，不能因此把候选当成命中
  it('resolve 返回 null 的候选被跳过', async () => {
    expect(await findOriginal(`x${THUMB_SUFFIX}`, () => null)).toBeNull()
  })
})

// ★ 素材库一屏几十张图会同时打过来。不去重的话同一个文件会被 ffmpeg 同时转好几次，
// 既浪费 CPU 又可能互相覆盖到半截文件。
describe('generateOnce', () => {
  it('同一路径并发只执行一次', async () => {
    let calls = 0
    const make = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return true }
    const [a, b, c] = await Promise.all([
      generateOnce('/x/1.png', make), generateOnce('/x/1.png', make), generateOnce('/x/1.png', make),
    ])
    expect(calls, '同一路径被重复生成了').toBe(1)
    expect([a, b, c]).toEqual([true, true, true])
  })

  it('不同路径各自执行', async () => {
    let calls = 0
    const make = async () => { calls++; return true }
    await Promise.all([generateOnce('/x/2.png', make), generateOnce('/x/3.png', make)])
    expect(calls).toBe(2)
  })

  // 执行完要把在途记录清掉，否则第二次请求会拿到上一次的旧结果
  it('完成后释放，下一次会重新执行', async () => {
    let calls = 0
    const make = async () => { calls++; return true }
    await generateOnce('/x/4.png', make)
    await generateOnce('/x/4.png', make)
    expect(calls).toBe(2)
  })

  it('失败也要释放，不能把错误结果永久缓存', async () => {
    const boom = async () => { throw new Error('ffmpeg 挂了') }
    await expect(generateOnce('/x/5.png', boom)).rejects.toThrow('ffmpeg 挂了')
    let called = false
    await generateOnce('/x/5.png', async () => { called = true; return true })
    expect(called, '失败后没释放在途记录').toBe(true)
  })
})

// ★ 素材库首次打开时一屏几十张图会同时缺缩略图。不限并发就是几十个 ffmpeg 一起起来，
// 那一下比不补生成还卡 —— web 是单进程 Node，CPU 被抢光时连别的页面都打不开。
describe('generateOnce —— 并发闸', () => {
  it('同时最多跑 2 个', async () => {
    let now = 0
    let peak = 0
    const make = async () => {
      now++; peak = Math.max(peak, now)
      await new Promise((r) => setTimeout(r, 30))
      now--
      return true
    }
    await Promise.all(Array.from({ length: 8 }, (_, i) => generateOnce(`/peak/${i}.png`, make)))
    expect(peak, `同时跑了 ${peak} 个 ffmpeg`).toBeLessThanOrEqual(2)
  })

  // 闸门泄漏会让后续请求永久卡住 —— 比慢更糟
  it('抛错也要放行后续任务，不能把闸门锁死', async () => {
    await expect(generateOnce('/leak/a.png', async () => { throw new Error('x') })).rejects.toThrow()
    await expect(generateOnce('/leak/b.png', async () => { throw new Error('y') })).rejects.toThrow()
    await expect(generateOnce('/leak/c.png', async () => { throw new Error('z') })).rejects.toThrow()
    // 闸门若泄漏，这一句会永远挂住（vitest 超时即失败）
    await expect(generateOnce('/leak/d.png', async () => true)).resolves.toBe(true)
  })
})
