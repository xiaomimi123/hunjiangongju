import { describe, it, expect } from 'vitest'
import { resolveBgmAbs } from './renderVideo'

// 第二层防护：即使 resolveBgmId 挑对了曲，文件仍可能在挑完到真正跑 ffmpeg 之间消失或损坏
// （data/ 目录被整个误删过一次，这是真实生产事故）。这里只测「文件不可读 → bgmAbs 置 null」
// 这条判定逻辑本身，不跑真的 ffmpeg。

describe('resolveBgmAbs —— 混音前的可读性关卡', () => {
  it('renderTask 本来就没绑 BGM（fileUrl=null）→ null，不调用 isReadable', async () => {
    let called = false
    const got = await resolveBgmAbs(null, async () => { called = true; return true })
    expect(got).toBeNull()
    expect(called).toBe(false)
  })

  it('文件可读 → 返回转换后的磁盘绝对路径', async () => {
    const got = await resolveBgmAbs('/api/files/bgm/x.mp3', async () => true)
    expect(got).not.toBeNull()
    expect(got).toMatch(/bgm[/\\]x\.mp3$/)
  })

  it('文件不可读（缺失/损坏）→ 当作本条无 BGM，返回 null，不抛错', async () => {
    const got = await resolveBgmAbs('/api/files/bgm/gone.mp3', async () => false)
    expect(got).toBeNull()
  })
})
