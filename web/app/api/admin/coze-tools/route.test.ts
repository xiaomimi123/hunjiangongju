import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const cozeFetchWorkflowParamsMock = vi.fn()
vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return { ...actual, cozeFetchWorkflowParams: (...args: unknown[]) => cozeFetchWorkflowParamsMock(...args) }
})

let GET: typeof import('./route').GET
let POST: typeof import('./route').POST
let PATCH: typeof import('./[id]/route').PATCH
let DELETE: typeof import('./[id]/route').DELETE
let fetchParamsPOST: typeof import('./fetch-params/route').POST
let runsGET: typeof import('./runs/route').GET

beforeAll(async () => {
  ;({ GET, POST } = await import('./route'))
  ;({ PATCH, DELETE } = await import('./[id]/route'))
  ;({ POST: fetchParamsPOST } = await import('./fetch-params/route'))
  ;({ GET: runsGET } = await import('./runs/route'))
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

const createdToolIds: string[] = []
const createdRunIds: string[] = []

afterEach(async () => {
  if (createdRunIds.length) {
    await prisma.cozeToolRun.deleteMany({ where: { id: { in: createdRunIds.splice(0) } } })
  }
  if (createdToolIds.length) {
    await prisma.cozeTool.deleteMany({ where: { id: { in: createdToolIds.splice(0) } } })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

function getReq(url = 'http://localhost/api/admin/coze-tools') {
  return new NextRequest(url, { method: 'GET' })
}

const VALID_BODY = {
  name: '文案改写',
  description: '把口播稿改写成更口语化的版本',
  workflowId: 'wf-abc_123',
  inputs: [{ name: 'input_text', label: '原文', type: 'text', required: true }],
  priceCredits: 2,
}

async function createTool(body: Record<string, unknown> = VALID_BODY) {
  const res = await POST(jsonReq('http://localhost/api/admin/coze-tools', 'POST', body), { params: {} })
  if (res.status === 200) {
    const json = await res.clone().json()
    createdToolIds.push(json.id)
  }
  return res
}

describe('POST /api/admin/coze-tools', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await createTool()
    expect([401, 403]).toContain(res.status)
  })

  it('inputs 非数组 → 400', async () => {
    const res = await createTool({ ...VALID_BODY, inputs: 'nope' })
    expect(res.status).toBe(400)
  })

  it('inputs[].name 带空格 → 400 且指明第几项', async () => {
    const res = await createTool({
      ...VALID_BODY,
      inputs: [{ name: 'bad name', label: '原文', type: 'text', required: true }],
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('第 1 项')
  })

  it('inputs[].type 不在白名单 → 400 且指明第几项', async () => {
    const res = await createTool({
      ...VALID_BODY,
      inputs: [{ name: 'a', label: '原文', type: 'weird', required: false }],
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('第 1 项')
  })

  it('inputs[].type=select 但无 options → 400 且指明第几项', async () => {
    const res = await createTool({
      ...VALID_BODY,
      inputs: [{ name: 'a', label: '选一个', type: 'select', required: false }],
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('第 1 项')
  })

  it('inputs[].type=select 但 options 是空数组 → 400', async () => {
    const res = await createTool({
      ...VALID_BODY,
      inputs: [{ name: 'a', label: '选一个', type: 'select', options: [], required: false }],
    })
    expect(res.status).toBe(400)
  })

  it('inputs[].label 为空 → 400', async () => {
    const res = await createTool({
      ...VALID_BODY,
      inputs: [{ name: 'a', label: '  ', type: 'text', required: false }],
    })
    expect(res.status).toBe(400)
  })

  it('priceCredits 超范围 → 400', async () => {
    const res = await createTool({ ...VALID_BODY, priceCredits: 1001 })
    expect(res.status).toBe(400)
  })

  it('priceCredits 非整数 → 400', async () => {
    const res = await createTool({ ...VALID_BODY, priceCredits: 1.5 })
    expect(res.status).toBe(400)
  })

  it('workflowId 为空 → 400', async () => {
    const res = await createTool({ ...VALID_BODY, workflowId: '' })
    expect(res.status).toBe(400)
  })

  it('合法创建 → 200，GET 回读一致', async () => {
    const res = await createTool()
    expect(res.status).toBe(200)
    const created = await res.json()
    expect(created.name).toBe(VALID_BODY.name)
    expect(created.workflowId).toBe(VALID_BODY.workflowId)
    expect(created.priceCredits).toBe(2)
    expect(created.inputs).toEqual(VALID_BODY.inputs.map((i) => ({ ...i })))

    const listRes = await GET(getReq(), { params: {} })
    const { tools } = await listRes.json()
    const mine = tools.find((t: { id: string }) => t.id === created.id)
    expect(mine).toBeTruthy()
    expect(mine.name).toBe(VALID_BODY.name)
  })
})

describe('PATCH /api/admin/coze-tools/[id]', () => {
  it('非 operator → 401/403', async () => {
    const created = await (await createTool()).json()
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { enabled: true }), { params: { id: created.id } })
    expect([401, 403]).toContain(res.status)
  })

  it('不存在 → 404', async () => {
    const res = await PATCH(jsonReq('http://localhost/x', 'PATCH', { enabled: true }), { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
  })

  it('上架/下架生效', async () => {
    const created = await (await createTool({ ...VALID_BODY, enabled: false })).json()
    expect(created.enabled).toBe(false)

    const upRes = await PATCH(jsonReq('http://localhost/x', 'PATCH', { enabled: true }), { params: { id: created.id } })
    expect(upRes.status).toBe(200)
    expect((await upRes.json()).enabled).toBe(true)

    const downRes = await PATCH(jsonReq('http://localhost/x', 'PATCH', { enabled: false }), { params: { id: created.id } })
    expect((await downRes.json()).enabled).toBe(false)
  })

  it('inputs 非法时拒绝更新', async () => {
    const created = await (await createTool()).json()
    const res = await PATCH(
      jsonReq('http://localhost/x', 'PATCH', { inputs: [{ name: 'bad name', label: 'x', type: 'text', required: false }] }),
      { params: { id: created.id } },
    )
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/admin/coze-tools/[id]', () => {
  it('无运行记录 → 物理删除', async () => {
    const created = await (await createTool()).json()
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: created.id } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.disabled).toBeUndefined()
    expect(await prisma.cozeTool.findUnique({ where: { id: created.id } })).toBeNull()
  })

  it('有运行记录 → 不删，改为下架', async () => {
    const created = await (await createTool({ ...VALID_BODY, enabled: true })).json()
    const run = await prisma.cozeToolRun.create({
      data: { toolId: created.id, userId: 'stu1', inputs: {}, creditsCost: 2 },
    })
    createdRunIds.push(run.id)

    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: created.id } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.disabled).toBe(true)
    expect(json.hint).toContain('下架')

    const stillThere = await prisma.cozeTool.findUnique({ where: { id: created.id } })
    expect(stillThere).not.toBeNull()
    expect(stillThere?.enabled).toBe(false)
  })

  it('不存在 → 404', async () => {
    const res = await DELETE(jsonReq('http://localhost/x', 'DELETE'), { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/admin/coze-tools/fetch-params', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await fetchParamsPOST(jsonReq('http://localhost/x', 'POST', { workflowId: 'wf-1' }), { params: {} })
    expect([401, 403]).toContain(res.status)
  })

  it('workflowId 非法 → 400', async () => {
    const res = await fetchParamsPOST(jsonReq('http://localhost/x', 'POST', { workflowId: '' }), { params: {} })
    expect(res.status).toBe(400)
  })

  it('返回 null 时给出手动兜底 hint', async () => {
    cozeFetchWorkflowParamsMock.mockResolvedValueOnce(null)
    const res = await fetchParamsPOST(jsonReq('http://localhost/x', 'POST', { workflowId: 'wf-1' }), { params: {} })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.params).toBeNull()
    expect(json.hint).toContain('手动')
  })

  it('拿到参数列表时原样透传', async () => {
    cozeFetchWorkflowParamsMock.mockResolvedValueOnce([{ name: 'input_text', type: 'string', required: true }])
    const res = await fetchParamsPOST(jsonReq('http://localhost/x', 'POST', { workflowId: 'wf-1' }), { params: {} })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.params).toEqual([{ name: 'input_text', type: 'string', required: true }])
  })

  it('配置问题抛错时走 502 且透出具体中文原因', async () => {
    cozeFetchWorkflowParamsMock.mockRejectedValueOnce(new Error('扣子未配置，请在模型配置里填 Token'))
    const res = await fetchParamsPOST(jsonReq('http://localhost/x', 'POST', { workflowId: 'wf-1' }), { params: {} })
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toContain('扣子未配置，请在模型配置里填 Token')
  })
})

describe('GET /api/admin/coze-tools/runs', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await runsGET(getReq('http://localhost/api/admin/coze-tools/runs'), { params: {} })
    expect([401, 403]).toContain(res.status)
  })

  it('倒序返回，按 toolId 可过滤', async () => {
    const created = await (await createTool()).json()
    const run1 = await prisma.cozeToolRun.create({
      data: { toolId: created.id, userId: 'stu1', inputs: {}, creditsCost: 2, status: 'SUCCEEDED' },
    })
    createdRunIds.push(run1.id)
    await new Promise((r) => setTimeout(r, 5))
    const run2 = await prisma.cozeToolRun.create({
      data: { toolId: created.id, userId: 'stu2', inputs: {}, creditsCost: 2, status: 'SUCCEEDED' },
    })
    createdRunIds.push(run2.id)

    const res = await runsGET(getReq(`http://localhost/api/admin/coze-tools/runs?toolId=${created.id}`), { params: {} })
    expect(res.status).toBe(200)
    const json = await res.json()
    const ids = json.runs.map((r: { id: string }) => r.id)
    expect(ids.indexOf(run2.id)).toBeLessThan(ids.indexOf(run1.id))
    expect(json.runs.every((r: { toolId: string }) => r.toolId === created.id)).toBe(true)
    // 列表字段收窄：不带 outputRaw/outputItems/inputs（可能很大，列表页用不上）；
    // user 是运营端认人用的合并字段（昵称+手机号），只含这两个子字段
    expect(Object.keys(json.runs[0]).sort()).toEqual(
      ['id', 'toolId', 'userId', 'status', 'errorMsg', 'creditsCost', 'createdAt', 'finishedAt', 'user'].sort(),
    )
    expect(json.runs[0].user === null || Object.keys(json.runs[0].user).sort().join() === 'email,nickname').toBe(true)
  })
})
