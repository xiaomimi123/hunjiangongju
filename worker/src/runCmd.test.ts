import { describe, it, expect } from 'vitest'
import { runCmd, probeText } from './runCmd'

// ★ spawnSync 阻塞的不是"当前任务",而是**整个 Node 事件循环**——
// BullMQ 的 concurrency=2 因此形同虚设:一个任务跑 ffmpeg 时另一个连一行都执行不了。
describe('runCmd', () => {
  it('成功时返回 ok 与输出', async () => {
    const r = await runCmd('echo', ['hello'])
    expect(r.ok).toBe(true)
    expect(r.out.trim()).toBe('hello')
    expect(r.status).toBe(0)
  })

  it('失败时 ok=false 并带上退出码与输出', async () => {
    const r = await runCmd('sh', ['-c', 'echo boom >&2; exit 3'])
    expect(r.ok).toBe(false)
    expect(r.status).toBe(3)
    expect(r.out, 'stderr 必须收进来，外部命令的错误信息大多在这里').toContain('boom')
  })

  // ★ 这条是这次改造的全部意义：执行期间事件循环必须还能跑别的东西
  it('执行期间不阻塞事件循环', async () => {
    let ticks = 0
    const t = setInterval(() => { ticks++ }, 10)
    await runCmd('sh', ['-c', 'sleep 0.3'])
    clearInterval(t)
    expect(ticks, `执行期间事件循环只跑了 ${ticks} 次，说明被阻塞了`).toBeGreaterThan(5)
  })

  it('支持 stdin 输入（坐标表编码就是往 ffmpeg 管道里灌帧）', async () => {
    const r = await runCmd('cat', [], { input: Buffer.from('从管道进来的') })
    expect(r.out).toContain('从管道进来的')
  })

  // 挂死的 ffmpeg 会一直占着队列 slot，必须能被强制结束
  it('超时会强制结束并标记失败', async () => {
    const r = await runCmd('sh', ['-c', 'sleep 5'], { timeoutMs: 150 })
    expect(r.ok).toBe(false)
    expect(r.out).toContain('超时')
  })

  it('命令不存在时抛错，而不是静默返回失败', async () => {
    await expect(runCmd('这个命令不存在-xyz', [])).rejects.toThrow()
  })
})

describe('probeText', () => {
  it('取 stdout 文本', async () => {
    expect(await probeText('echo', ['12.5'])).toBe('12.5')
  })

  // 探测失败不该让整条出片链路抛错，调用方自有兜底值
  it('失败与命令不存在都返回空串', async () => {
    expect(await probeText('sh', ['-c', 'exit 1'])).toBe('')
    expect(await probeText('这个命令不存在-xyz', [])).toBe('')
  })
})
