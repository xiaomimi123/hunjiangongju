import { describe, it, expect } from 'vitest'
import { parseSceneCuts } from './scenes'

// 模拟 ffmpeg select='gt(scene,0.3)',showinfo 的 stderr 输出：
// 3 个场景切点，含乱序 + 重复 pts_time，用于验证 秒→ms 取整 + 去重 + 升序。
const SHOWINFO_OUTPUT = `
[Parsed_showinfo_1 @ 0x7f] n:0 pts:0 pts_time:2.5 pos:0 fmt:yuv420p
[Parsed_showinfo_1 @ 0x7f] n:1 pts:0 pts_time:0.04 pos:0 fmt:yuv420p
[Parsed_showinfo_1 @ 0x7f] n:2 pts:0 pts_time:4.001 pos:0 fmt:yuv420p
[Parsed_showinfo_1 @ 0x7f] n:3 pts:0 pts_time:2.5 pos:0 fmt:yuv420p
`

describe('parseSceneCuts（showinfo → cut_points_ms）', () => {
  it('构造输出 → 秒转 ms 取整 + 去重 + 升序', () => {
    // 0.04→40, 2.5→2500(重复合一), 4.001→4001；升序
    expect(parseSceneCuts(SHOWINFO_OUTPUT)).toEqual([40, 2500, 4001])
  })

  it('无场景变化（无 pts_time）→ 空数组', () => {
    const noScenes = `
[Parsed_select_0 @ 0x7f] frame dropped
ffmpeg version 6.0 static
`
    expect(parseSceneCuts(noScenes)).toEqual([])
  })
})
