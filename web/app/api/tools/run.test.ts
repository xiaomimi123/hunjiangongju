import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

// 入队走真实 BullMQ/Redis 会让路由测试依赖 Redis，用 no-op 替身隔离，跟 generate 路由测试同思路。
const enqueueCozeRunMock = vi.fn()
vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return { ...actual, enqueueCozeRun: (...args: unknown[]) => enqueueCozeRunMock(...args) }
})

let toolsGET: typeof import('./route').GET
let runPOST: typeof import('./[id]/run/route').POST
let runsGET: typeof import('./runs/route').GET
let runDetailGET: typeof import('./runs/[id]/route').GET

beforeAll(async () => {
  ;({ GET: toolsGET } = await import('./route'))
  ;({ POST: runPOST } = await import('./[id]/run/route'))
  ;({ GET: runsGET } = await import('./runs/route'))
  ;({ GET: runDetailGET } = await import('./runs/[id]/route'))
})

beforeEach(() => {
  requireRoleMock.mockReset()
  enqueueCozeRunMock.mockReset()
})

const toolIds: string[] = []
const runIds: string[] = []
const userIds: string[] = []

afterEach(async () => {
  if (runIds.length) await prisma.cozeToolRun.deleteMany({ where: { id: { in: runIds.splice(0) } } })
  if (toolIds.length) await prisma.cozeTool.deleteMany({ where: { id: { in: toolIds.splice(0) } } })
})

afterAll(async () => {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

async function makeStudent(credits?: number) {
  const u = await prisma.user.create({
    data: {
      email: `1${String(Date.now()).slice(-7)}${String(userIds.length).padStart(3, '0')}`,
      passwordHash: 'x',
      role: 'student',
      ...(credits === undefined ? {} : { credits }),
    },
  })
  userIds.push(u.id)
  return u
}

async function makeTool(overrides: Record<string, unknown> = {}) {
  const tool = await prisma.cozeTool.create({
    data: {
      name: '文案改写',
      workflowId: 'wf-test',
      priceCredits: 2,
      enabled: true,
      inputs: [
        { name: 'input_text', label: '原文', type: 'text', required: true },
        { name: 'style', label: '风格', type: 'select', options: ['活泼', '严肃'], required: false },
        { name: 'cover', label: '封面图', type: 'image', required: false },
      ],
      ...overrides,
    },
  })
  toolIds.push(tool.id)
  return tool
}

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

function getReq(url: string) {
  return new NextRequest(url, { method: 'GET' })
}

// validateInputsAgainst 纯函数的单测搬到 web/lib/cozeInputs.test.ts（同目录，跟被测代码放一起）。

// ---------------- GET /api/tools ----------------
describe('GET /api/tools', () => {
  it('未登录 → 401', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(401, '未登录'))
    const res = await toolsGET(getReq('http://localhost/api/tools'), { params: {} })
    expect(res.status).toBe(401)
  })

  it('只返回 enabled 的工具，字段收窄，不含 workflowId', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'stu1', role: 'student' })
    const enabledTool = await makeTool({ enabled: true, sortOrder: 1 })
    const disabledTool = await makeTool({ enabled: false, sortOrder: 2 })

    const res = await toolsGET(getReq('http://localhost/api/tools'), { params: {} })
    expect(res.status).toBe(200)
    const { tools } = await res.json()
    const ids = tools.map((t: { id: string }) => t.id)
    expect(ids).toContain(enabledTool.id)
    expect(ids).not.toContain(disabledTool.id)
    expect(Object.keys(tools[0]).sort()).toEqual(['id', 'name', 'description', 'priceCredits', 'inputs'].sort())
  })
})

// ---------------- POST /api/tools/[id]/run ----------------
describe('POST /api/tools/[id]/run', () => {
  it('未登录 → 401', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(401, '未登录'))
    const res = await runPOST(jsonReq('http://localhost/x', 'POST', { inputs: {} }), { params: { id: 'x' } })
    expect(res.status).toBe(401)
  })

  it('工具下架 → 404', async () => {
    const u = await makeStudent(10)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const tool = await makeTool({ enabled: false })
    const res = await runPOST(
      jsonReq('http://localhost/x', 'POST', { inputs: { input_text: 'hi' } }),
      { params: { id: tool.id } },
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('不存在或已下架')
  })

  it('工具不存在 → 404', async () => {
    const u = await makeStudent(10)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await runPOST(
      jsonReq('http://localhost/x', 'POST', { inputs: { input_text: 'hi' } }),
      { params: { id: 'ghost' } },
    )
    expect(res.status).toBe(404)
  })

  it('image 路径穿越 → 400', async () => {
    const u = await makeStudent(10)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const tool = await makeTool()
    const res = await runPOST(
      jsonReq('http://localhost/x', 'POST', {
        inputs: { input_text: 'hi', cover: '../../etc/passwd' },
      }),
      { params: { id: tool.id } },
    )
    expect(res.status).toBe(400)
  })

  it('积分不足 → 403 + NO_CREDITS，且未建 run、未入队、未扣分', async () => {
    const u = await makeStudent(1)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const tool = await makeTool({ priceCredits: 2 })
    const res = await runPOST(
      jsonReq('http://localhost/x', 'POST', { inputs: { input_text: 'hi' } }),
      { params: { id: tool.id } },
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('NO_CREDITS')
    expect(await prisma.cozeToolRun.count({ where: { toolId: tool.id } })).toBe(0)
    expect(enqueueCozeRunMock).not.toHaveBeenCalled()
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(1)
  })

  it('积分充足 → 成功、扣分、creditsCost 正确、入队', async () => {
    const u = await makeStudent(10)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const tool = await makeTool({ priceCredits: 3 })
    const res = await runPOST(
      jsonReq('http://localhost/x', 'POST', { inputs: { input_text: 'hi' } }),
      { params: { id: tool.id } },
    )
    expect(res.status).toBe(200)
    const { id } = await res.json()
    runIds.push(id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(7)
    const run = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id } })
    expect(run.creditsCost).toBe(3)
    expect(run.userId).toBe(u.id)
    expect(enqueueCozeRunMock).toHaveBeenCalledWith(id)
  })

  it('operator 免扣分，creditsCost 记 0', async () => {
    const tool = await makeTool({ priceCredits: 5 })
    requireRoleMock.mockResolvedValue({ userId: 'op-run-x', role: 'operator' })
    const res = await runPOST(
      jsonReq('http://localhost/x', 'POST', { inputs: { input_text: 'hi' } }),
      { params: { id: tool.id } },
    )
    expect(res.status).toBe(200)
    const { id } = await res.json()
    runIds.push(id)
    const run = await prisma.cozeToolRun.findUniqueOrThrow({ where: { id } })
    expect(run.creditsCost).toBe(0)
  })

  it('并发抢最后的积分 → 恰好放行一个，余额不为负', async () => {
    const u = await makeStudent(2)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const tool = await makeTool({ priceCredits: 2 })
    const results = await Promise.all([
      runPOST(jsonReq('http://localhost/x', 'POST', { inputs: { input_text: 'a' } }), { params: { id: tool.id } }),
      runPOST(jsonReq('http://localhost/x', 'POST', { inputs: { input_text: 'b' } }), { params: { id: tool.id } }),
    ])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 403])
    for (const r of results) if (r.status === 200) runIds.push((await r.json()).id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(0)
  })

  it('priceCredits=0 的免费工具 → 不扣分', async () => {
    const u = await makeStudent(3)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const tool = await makeTool({ priceCredits: 0 })
    const res = await runPOST(
      jsonReq('http://localhost/x', 'POST', { inputs: { input_text: 'hi' } }),
      { params: { id: tool.id } },
    )
    expect(res.status).toBe(200)
    const { id } = await res.json()
    runIds.push(id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(3)
    expect((await prisma.cozeToolRun.findUniqueOrThrow({ where: { id } })).creditsCost).toBe(0)
  })

  // 必填 text 字段传对象绕过必填校验的回归：validateInputsAgainst 单测已覆盖纯函数层面，
  // 这里在路由层面复核——绕过成功的话会白扣分、白建 run，是能直接花钱验证到的后果。
  it('必填字段传对象 {} → 400，不扣分不建 run', async () => {
    const u = await makeStudent(10)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const tool = await makeTool({ priceCredits: 2 })
    const res = await runPOST(
      jsonReq('http://localhost/x', 'POST', { inputs: { input_text: {} } }),
      { params: { id: tool.id } },
    )
    expect(res.status).toBe(400)
    expect(await prisma.cozeToolRun.count({ where: { toolId: tool.id } })).toBe(0)
    expect(enqueueCozeRunMock).not.toHaveBeenCalled()
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).credits).toBe(10)
  })

  it('限流：超过 10 次/分钟 → 429', async () => {
    const u = await makeStudent(100)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    // checkRate 在 requireRole 之后、findUnique 之前就判定，用不存在的工具 id 也能触发限流，
    // 不用真造工具/扣分，前 10 次落在「工具不存在」的 404 上，第 11 次落在限流的 429 上。
    let last: Response | undefined
    for (let i = 0; i < 11; i++) {
      last = await runPOST(jsonReq('http://localhost/x', 'POST', { inputs: {} }), { params: { id: 'ghost-rate' } })
    }
    expect(last?.status).toBe(429)
  })
})

// ---------------- GET /api/tools/runs & /api/tools/runs/[id] ----------------
describe('学员运行记录：列表与详情', () => {
  it('runs 列表未登录 → 401', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(401, '未登录'))
    const res = await runsGET(getReq('http://localhost/api/tools/runs'), { params: {} })
    expect(res.status).toBe(401)
  })

  it('runs 列表只返回本人的，倒序', async () => {
    const u1 = await makeStudent(10)
    const u2 = await makeStudent(10)
    const tool = await makeTool()
    const r1 = await prisma.cozeToolRun.create({ data: { toolId: tool.id, userId: u1.id, inputs: {}, creditsCost: 1 } })
    runIds.push(r1.id)
    await new Promise((r) => setTimeout(r, 5))
    const r2 = await prisma.cozeToolRun.create({ data: { toolId: tool.id, userId: u1.id, inputs: {}, creditsCost: 1 } })
    runIds.push(r2.id)
    const rOther = await prisma.cozeToolRun.create({ data: { toolId: tool.id, userId: u2.id, inputs: {}, creditsCost: 1 } })
    runIds.push(rOther.id)

    requireRoleMock.mockResolvedValue({ userId: u1.id, role: 'student' })
    const res = await runsGET(getReq('http://localhost/api/tools/runs'), { params: {} })
    expect(res.status).toBe(200)
    const { runs } = await res.json()
    const ids = runs.map((r: { id: string }) => r.id)
    expect(ids).toContain(r1.id)
    expect(ids).toContain(r2.id)
    expect(ids).not.toContain(rOther.id)
    expect(ids.indexOf(r2.id)).toBeLessThan(ids.indexOf(r1.id))
    // 列表不带 inputs/outputRaw：outputRaw 是扣子原始响应整包，将来会含 debug_url（带 workflow_id）
    const raw = JSON.stringify(runs)
    expect(raw).not.toContain('outputRaw')
    expect(raw).not.toContain('workflowId')
    expect(raw).not.toContain('"inputs"')
  })

  it('详情：本人可查，且不泄漏 outputRaw / workflowId / inputs', async () => {
    const u = await makeStudent(10)
    const tool = await makeTool()
    const run = await prisma.cozeToolRun.create({
      data: {
        toolId: tool.id,
        userId: u.id,
        inputs: { input_text: 'secret prompt' },
        creditsCost: 1,
        outputRaw: { debug_url: 'https://coze.example/debug?workflow_id=wf-should-not-leak' },
      },
    })
    runIds.push(run.id)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await runDetailGET(getReq('http://localhost/x'), { params: { id: run.id } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe(run.id)
    const raw = JSON.stringify(json)
    expect(raw).not.toContain('outputRaw')
    expect(raw).not.toContain('workflowId')
    expect(raw).not.toContain('wf-should-not-leak')
    expect(raw).not.toContain('secret prompt')
    expect(json).not.toHaveProperty('userId')
  })

  it('详情：越权——学员 A 查学员 B 的 run → 404（不是 403）', async () => {
    const uA = await makeStudent(10)
    const uB = await makeStudent(10)
    const tool = await makeTool()
    const run = await prisma.cozeToolRun.create({ data: { toolId: tool.id, userId: uB.id, inputs: {}, creditsCost: 1 } })
    runIds.push(run.id)
    requireRoleMock.mockResolvedValue({ userId: uA.id, role: 'student' })
    const res = await runDetailGET(getReq('http://localhost/x'), { params: { id: run.id } })
    expect(res.status).toBe(404)
  })

  it('详情：不存在的 id → 404', async () => {
    const u = await makeStudent(10)
    requireRoleMock.mockResolvedValue({ userId: u.id, role: 'student' })
    const res = await runDetailGET(getReq('http://localhost/x'), { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
  })

  it('详情：operator 可看任意学员的 run', async () => {
    const u = await makeStudent(10)
    const tool = await makeTool()
    const run = await prisma.cozeToolRun.create({ data: { toolId: tool.id, userId: u.id, inputs: {}, creditsCost: 1 } })
    runIds.push(run.id)
    requireRoleMock.mockResolvedValue({ userId: 'op-view-x', role: 'operator' })
    const res = await runDetailGET(getReq('http://localhost/x'), { params: { id: run.id } })
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(run.id)
  })
})
