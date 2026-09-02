import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cozeRunWorkflow, cozeUploadFile, cozeFetchWorkflowParams } from './coze'

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

describe('cozeRunWorkflow', () => {
  it('成功解析：raw 拿到 data 字段原样值（不在客户端解析）', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 0, msg: 'success', data: '{"output":"hi"}' }))
    const { raw } = await cozeRunWorkflow('wf-1', { a: 1 }, { fetchImpl })
    expect(raw).toBe('{"output":"hi"}')
  })

  it('扣子返回 code!=0 → 抛中文错误并带上 msg', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 4000, msg: '参数缺失', data: null }))
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl })).rejects.toThrow('参数缺失')
  })

  it('未配置（未启用/缺 apiKey）→ 抛「扣子未配置」', async () => {
    mockGetCapabilityConfig.mockResolvedValue({ ...okCfg, enabled: false })
    const fetchImpl = vi.fn()
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl })).rejects.toThrow('扣子未配置')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('超时 → 抛错', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('aborted', 'TimeoutError'))
    await expect(cozeRunWorkflow('wf-1', {}, { fetchImpl })).rejects.toThrow('超时')
  })

  it('Authorization 头是 Bearer <apiKey>', async () => {
    mockGetCapabilityConfig.mockResolvedValue(okCfg)
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 0, msg: '', data: {} }))
    await cozeRunWorkflow('wf-1', {}, { fetchImpl })
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test-123')
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
