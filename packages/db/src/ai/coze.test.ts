import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cozeRunWorkflow, cozeUploadFile, cozeFetchWorkflowParams, parseRunHistoryText } from './coze'

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

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  mockGetCapabilityConfig.mockReset()
})

describe('cozeRunWorkflow（异步提交 + 轮询）', () => {
  const submitRes = () => jsonRes({ code: 0, msg: '', execute_id: 'exec-1', debug_url: 'https://x' })
  const historyRes = (status: string, extra = '') =>
    new Response(`{"code":0,"msg":"","data":[{"execute_id":"exec-1","execute_status":"${status}"${extra}}]}`, { status: 200 })

  it('提交带 is_async:true，轮询到 Success 后 raw 拿到 output', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(submitRes())
      .mockResolvedValueOnce(historyRes('Running'))
      .mockResolvedValueOnce(historyRes('Success', ',"output":"{\\"Output\\":\\"https://v.example/a.mp4\\"}"'))
    const { raw } = await cozeRunWorkflow('wf-1', { a: 1 }, { fetchImpl, pollIntervalMs: 1 })
    expect(raw).toBe('{"Output":"https://v.example/a.mp4"}')
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(body.is_async).toBe(true)
    expect(String(fetchImpl.mock.calls[1][0])).toContain('/v1/workflows/wf-1/run_histories/exec-1')
  })

  it('轮询到 Fail → 抛中文错误并带 error_message', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(submitRes())
      .mockResolvedValueOnce(historyRes('Fail', ',"error_code":"720701002","error_message":"节点炸了"'))
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl, pollIntervalMs: 1 })).rejects.toThrow('运行失败')
  })

  it('提交返回 code!=0 → 抛中文错误并带上 msg', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 4000, msg: '参数缺失', data: null }))
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl })).rejects.toThrow('参数缺失')
  })

  it('提交未返回 execute_id → 抛错', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 0, msg: '', data: 'x' }))
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl })).rejects.toThrow('execute_id')
  })

  it('未配置（未启用/缺 apiKey）→ 抛「扣子未配置」', async () => {
    mockGetCapabilityConfig.mockResolvedValue({ ...okCfg, enabled: false })
    const fetchImpl = vi.fn()
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl })).rejects.toThrow('扣子未配置')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('总超时 → 抛错（轮询一直 Running）', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(submitRes())
      .mockResolvedValue(historyRes('Running'))
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl, timeoutMs: 30, pollIntervalMs: 1 })).rejects.toThrow('超时')
  })

  it('轮询响应 401 → 立刻抛鉴权失败，不再重试', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(submitRes())
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl, pollIntervalMs: 1 })).rejects.toThrow('鉴权失败')
  })

  it('Authorization 头是 Bearer <apiKey>', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(submitRes())
      .mockResolvedValueOnce(historyRes('Success', ',"output":"ok"'))
    await cozeRunWorkflow('wf-1', {}, { fetchImpl, pollIntervalMs: 1 })
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test-123')
  })
})

describe('parseRunHistoryText（含扣子非法 JSON 兜底）', () => {
  it('合法 JSON：解析出状态与 output', () => {
    const h = parseRunHistoryText('{"code":0,"data":[{"execute_status":"Success","output":"hi"}]}')
    expect(h).toEqual({ status: 'Success', output: 'hi' })
  })

  it('非法 JSON（实测的 node_status 转义 bug）：正则捞出状态与 output', () => {
    // 取自 2026-09-03 spike 的真实响应片段：output 里 \\" 该写成 \\\" ，整体 JSON.parse 必炸
    const text = '{"code":0,"data":[{"execute_status":"Running","output":"{\\"node_status\\":\\"{\\\\"输出\\\\":{}}\\",\\"Output\\":\\"\\"}","error_code":""}]}'
    expect(() => JSON.parse(text)).toThrow()
    const h = parseRunHistoryText(text)
    expect(h?.status).toBe('Running')
  })

  it('连状态都提不出 → null', () => {
    expect(parseRunHistoryText('<html>bad gateway</html>')).toBeNull()
  })
})

describe('cozeUploadFile', () => {
  it('成功解析出 fileId', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 0, msg: '', data: { id: 'file-abc' } }))
    const { fileId } = await cozeUploadFile(Buffer.from('hello'), 'clip.mp4', { fetchImpl })
    expect(fileId).toBe('file-abc')
  })

  it('multipart 请求体带上文件名（file 字段）', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 0, msg: '', data: { id: 'file-abc' } }))
    await cozeUploadFile(Buffer.from('hello'), 'clip.mp4', { fetchImpl })
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.body).toBeInstanceOf(FormData)
    const file = (init.body as FormData).get('file') as File
    expect(file).toBeTruthy()
    expect(file.name).toBe('clip.mp4')
  })

  it('未配置 → 抛「扣子未配置」', async () => {
    mockGetCapabilityConfig.mockResolvedValue({ ...okCfg, apiKey: '' })
    await expect(cozeUploadFile(Buffer.from('x'), 'a.mp4')).rejects.toThrow('扣子未配置')
  })
})

describe('cozeFetchWorkflowParams', () => {
  it('成功解析出参数列表', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonRes({ code: 0, msg: '', data: { parameters: [{ name: 'topic', type: 'string', required: true }] } }),
    )
    const params = await cozeFetchWorkflowParams('wf-1', { fetchImpl })
    expect(params).toEqual([{ name: 'topic', type: 'string', required: true }])
  })

  it('HTTP 404 → 返回 null（预期路径）', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))
    const params = await cozeFetchWorkflowParams('wf-1', { fetchImpl })
    expect(params).toBeNull()
  })

  it('解析不出参数列表 → 返回 null', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 0, msg: '', data: {} }))
    const params = await cozeFetchWorkflowParams('wf-1', { fetchImpl })
    expect(params).toBeNull()
  })

  it('401 权限错 → 抛出（配置问题，要让运营看见）', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    await expect(cozeFetchWorkflowParams('wf-1', { fetchImpl })).rejects.toThrow('鉴权失败')
  })

  it('网络错误 → 抛出（配置问题，要让运营看见）', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(cozeFetchWorkflowParams('wf-1', { fetchImpl })).rejects.toThrow('fetch failed')
  })

  it('未配置 → 抛「扣子未配置」', async () => {
    mockGetCapabilityConfig.mockResolvedValue({ ...okCfg, baseUrl: '' })
    await expect(cozeFetchWorkflowParams('wf-1')).rejects.toThrow('扣子未配置')
  })
})
