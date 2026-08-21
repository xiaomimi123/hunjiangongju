// 统一的**异步**外部命令执行器。
//
// ── 为什么必须异步 ──
//
// 原先渲染、配音、探测时长全用 `spawnSync`。它阻塞的不是"当前这个任务"，
// 而是**整个 Node 事件循环**——BullMQ 的 concurrency=2 因此形同虚设：
// 只要有一个任务在跑 ffmpeg，另一个任务连一行代码都执行不了。
// 线上实测单条片子 9.9 分钟里有近 2 分钟在 spawnSync 里，这段时间整个 worker 是死的。
//
// 换成异步后 concurrency 才真正生效，也才谈得上把 CPU 任务与网络任务分开跑。

import { spawn } from 'child_process'

export interface RunResult {
  ok: boolean
  /** stdout + stderr 合并。外部命令的错误信息大多在 stderr，分开取容易漏。 */
  out: string
  status: number | null
}

export interface RunOpts {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** 写进 stdin 的数据（坐标表编码就是往 ffmpeg 管道里灌原始帧） */
  input?: Buffer
  /** 超时（毫秒）。到点 SIGKILL —— 挂死的 ffmpeg 会一直占着队列 slot。 */
  timeoutMs?: number
}

/** 输出保留上限：ffmpeg 出错时能刷出几十 MB，全存下来毫无意义还占内存 */
const MAX_OUT = 64 * 1024

export function runCmd(bin: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.env ? { env: opts.env } : {}),
      stdio: [opts.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })

    let out = ''
    const append = (chunk: Buffer) => {
      if (out.length >= MAX_OUT) return
      out += chunk.toString('utf8')
      if (out.length > MAX_OUT) out = out.slice(0, MAX_OUT)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        out += `\n[runCmd] 超时 ${opts.timeoutMs}ms，已强制结束`
        child.kill('SIGKILL')
      }, opts.timeoutMs)
    }

    // spawn 失败（命令不存在等）走 error 事件，不会有 close
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (status) => {
      if (timer) clearTimeout(timer)
      resolve({ ok: status === 0, out, status })
    })

    if (opts.input) {
      // stdin 提前关闭（下游只读了一部分就退出）会抛 EPIPE，那不是错误：
      // 退出码才是判据，这里吞掉即可，否则会把正常结束报成失败。
      child.stdin?.on('error', () => { /* EPIPE 等，忽略 */ })
      child.stdin?.end(opts.input)
    }
  })
}

/** 只要 stdout 文本的场景（ffprobe 探测）。失败返回空串，由调用方兜底。 */
export async function probeText(bin: string, args: string[]): Promise<string> {
  try {
    const r = await runCmd(bin, args)
    return r.ok ? r.out.trim() : ''
  } catch {
    return ''
  }
}
