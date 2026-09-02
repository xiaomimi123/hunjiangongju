import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cozeProbeWorkflowParams } from './cozeProbe'

const mockGetCapabilityConfig = vi.fn()
vi.mock('./config', () => ({
  getCapabilityConfig: (...args: unknown[]) => mockGetCapabilityConfig(...args),
}))

const okCfg = {
  capability: 'coze' as const,
  baseUrl: 'https://api.coze.cn',
  apiKey: 'sk-test-123',
  model: '',
  enabled: true,
  extra: {},
}

// 造一条 SSE 响应：首行 data: 带指定 JSON
function sseRes(payload: Record<string, unknown>, status = 200): Response {
  const body = `event: Error\ndata: ${JSON.stringify(payload)}\n\n`
  return new Response(body, { status })
}

beforeEach(() => {
  mockGetCapabilityConfig.mockReset()
  mockGetCapabilityConfig.mockResolvedValue(okCfg)
})

describe('cozeProbeWorkflowParams', () => {
  it('三轮收敛：missing → missing → file 转换报错改型 → 无错误事件跑通 started=true', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(sseRes({ error_message: 'Missing parameter: KT_video', error_code: 5000 }))
      .mockResolvedValueOnce(sseRes({ error_message: 'Missing parameter: KT_title', error_code: 5000 }))
      .mockResolvedValueOnce(sseRes({ error_message: "The request parameter is illegal, see: value '测试' can't convert to file", error_code: 5000 }))
      .mockResolvedValueOnce(sseRes({ event: 'Message', content: 'ok' }))

    const result = await cozeProbeWorkflowParams('wf-1', { fetchImpl })

    expect(result.started).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.fields).toEqual([
      { name: 'KT_video', type: 'text', required: true },
      { name: 'KT_title', type: 'image', required: true },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(4)

    // 第 3 轮的 file 转换报错针对最近补的字段 KT_title，把它的探测值换成 file_id JSON；
    // KT_video（先探到的字段）维持文本探测值不变；第 4 轮沿用两者
    const body3 = JSON.parse((fetchImpl.mock.calls[2][1] as RequestInit).body as string)
    expect(body3.parameters.KT_title).toBe('探测')
    const body4 = JSON.parse((fetchImpl.mock.calls[3][1] as RequestInit).body as string)
    expect(body4.parameters.KT_video).toBe('探测')
    expect(body4.parameters.KT_title).toBe(JSON.stringify({ file_id: '0' }))
  })

  it('maxRounds 用尽仍未收敛 → started=false，返回已探到的字段', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      const known = Object.keys(body.parameters)
      const next = `field${known.length}`
      return Promise.resolve(sseRes({ error_message: `Missing parameter: ${next}`, error_code: 5000 }))
    })

    const result = await cozeProbeWorkflowParams('wf-1', { fetchImpl, maxRounds: 3 })

    expect(result.started).toBe(false)
    expect(result.fields).toHaveLength(3)
    expect(result.fields.map((f) => f.name)).toEqual(['field0', 'field1', 'field2'])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('鉴权失败（HTTP 401）→ 抛中文错误，不重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    await expect(cozeProbeWorkflowParams('wf-1', { fetchImpl })).rejects.toThrow('鉴权失败')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('鉴权失败（error_code 4100）→ 抛中文错误，不重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseRes({ error_message: 'authentication failed', error_code: 4100 }))
    await expect(cozeProbeWorkflowParams('wf-1', { fetchImpl })).rejects.toThrow('鉴权失败')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('非 Missing/非 file 转换错误（工作流未发布）→ 收敛，started=false，错误进 error 字段', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseRes({ error_message: 'workflow not published', error_code: 6000 }))
    const result = await cozeProbeWorkflowParams('wf-1', { fetchImpl })
    expect(result.started).toBe(false)
    expect(result.error).toBe('workflow not published')
    expect(result.fields).toEqual([])
  })

  it('未配置扣子 → 抛「扣子未配置」，不发请求', async () => {
    mockGetCapabilityConfig.mockResolvedValue({ ...okCfg, enabled: false })
    const fetchImpl = vi.fn()
    await expect(cozeProbeWorkflowParams('wf-1', { fetchImpl })).rejects.toThrow('扣子未配置')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
