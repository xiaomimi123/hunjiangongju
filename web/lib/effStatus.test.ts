import { describe, it, expect } from 'vitest'
import { effStatus, summarizeGenTasks } from './effStatus'

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


describe('summarizeGenTasks —— 仪表盘按有效状态汇总', () => {
  // ★ 这条钉住仪表盘的历史 bug：按 generationTask.status 统计时，
  // 「已完成」查 status='EXPORTED' 恒为 0（生成任务停在 VISUAL_RENDERING，
  // EXPORTED 只存在于 RenderTask 上）。
  it('渲染已完成的任务计入已完成，不再算处理中', () => {
    const out = summarizeGenTasks([
      { status: 'VISUAL_RENDERING', renderTasks: [{ status: 'EXPORTED' }] },
      { status: 'VISUAL_RENDERING', renderTasks: [{ status: 'RENDERING' }] },
      { status: 'SCRIPT_GENERATING', renderTasks: [] },
    ])
    expect(out.exported).toBe(1)
    expect(out.funnel.done).toBe(1)
    expect(out.funnel.processing).toBe(2)
  })

  it('渲染失败 / 待预览按有效状态归桶', () => {
    const out = summarizeGenTasks([
      { status: 'VISUAL_RENDERING', renderTasks: [{ status: 'FAILED' }] },
      { status: 'VISUAL_RENDERING', renderTasks: [{ status: 'PREVIEW_PENDING' }] },
      { status: 'FAILED', renderTasks: [] },
    ])
    expect(out.failed).toBe(2)
    expect(out.previewPending).toBe(1)
    expect(out.funnel.waiting).toBe(1)
    expect(out.funnel.failed).toBe(2)
  })

  it('没有渲染任务时回退生成态（老任务零回归）', () => {
    const out = summarizeGenTasks([{ status: 'ASSET_READY', renderTasks: [] }])
    expect(out.funnel.waiting).toBe(1)
  })
})
