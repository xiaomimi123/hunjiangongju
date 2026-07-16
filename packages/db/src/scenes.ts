// ffmpeg showinfo → 场景切点 纯解析（毫秒制，确定性、可单测，不依赖 ffmpeg）
// 场景检测 filter：select='gt(scene,0.3)',showinfo；切点以 stderr showinfo 行的 pts_time:<秒> 记录。

/** 从 ffmpeg 输出中正则抽 pts_time（秒）→ ms 整数，去重升序 */
export function parseSceneCuts(output: string): number[] {
  const re = /pts_time:([0-9.]+)/g
  const set = new Set<number>()
  let m: RegExpExecArray | null
  while ((m = re.exec(output)) !== null) {
    set.add(Math.round(parseFloat(m[1]) * 1000))
  }
  return Array.from(set).sort((a, b) => a - b)
}
