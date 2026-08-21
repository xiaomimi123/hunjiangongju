import { describe, it, expect } from 'vitest'
import { effStatus } from './effStatus'

// ★ 学员 autoRender 任务的 GenerationTask.status 会**停在 VISUAL_RENDERING** 不再前进，
// 真实进度在最新 RenderTask 上。直接展示 status 的表现是
// 「任务早就出片了，页面还一直显示画面渲染中」——线上首页就是这么错的。
describe('effStatus', () => {
  it('有 RenderTask 时用它的状态，而不是停住的生成状态', () => {
    expect(effStatus({ status: 'VISUAL_RENDERING', renderTasks: [{ status: 'EXPORTED' }] })).toBe('EXPORTED')
    expect(effStatus({ status: 'VISUAL_RENDERING', renderTasks: [{ status: 'QC_FAILED' }] })).toBe('QC_FAILED')
  })

  // 接口按 createdAt desc take 1 返回，所以第 0 个就是最新的那次合成
  it('取第一个（接口已按最新排序）', () => {
    expect(effStatus({ status: 'VISUAL_RENDERING', renderTasks: [{ status: 'RENDERING' }, { status: 'FAILED' }] }))
      .toBe('RENDERING')
  })

  it('还没排到渲染时回退生成阶段状态', () => {
    expect(effStatus({ status: 'SCRIPT_GENERATING', renderTasks: [] })).toBe('SCRIPT_GENERATING')
    expect(effStatus({ status: 'FAILED', renderTasks: [] })).toBe('FAILED')
  })
})
