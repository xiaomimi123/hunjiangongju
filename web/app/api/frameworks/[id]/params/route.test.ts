import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { GET, PATCH } = await import('./route')

const frameworkIds: string[] = []
afterAll(async () => {
  await prisma.copyFramework.deleteMany({ where: { id: { in: frameworkIds } } })
  await prisma.$disconnect()
})

async function makeFramework(overlayTemplate?: unknown) {
  const fw = await prisma.copyFramework.create({
    data: { frameworkText: 'T', overlayTemplate: (overlayTemplate ?? undefined) as never },
  })
  frameworkIds.push(fw.id)
  return fw
}

const req = (body?: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const ctx = (id: string) => ({ params: { id } })

async function overlayOf(id: string) {
  const fw = await prisma.copyFramework.findUniqueOrThrow({ where: { id } })
  return fw.overlayTemplate as Record<string, unknown>
}

beforeEach(() => {
  requireRoleMock.mockReset()
  requireRoleMock.mockResolvedValue({ userId: 'op1', role: 'operator' })
})

describe('GET /api/frameworks/[id]/params', () => {
  it('返回合并了默认值的有效参数', async () => {
    const fw = await makeFramework({ __templateParams: { mode: 'flash', audio: { bgmVolume: 0.5 } } })
    const d = await (await GET(req(), ctx(fw.id))).json()
    expect(d.effective.audio.bgmVolume).toBe(0.5)
    // 没写过的字段要有默认值，否则界面上是一片空白
    expect(d.effective.body.subtitlePosY).toBe(0.78)
    expect(d.hasDraftParams).toBe(true)
  })

  it('从没解析过草稿的框架 → hasDraftParams=false，仍给出默认值', async () => {
    const fw = await makeFramework()
    const d = await (await GET(req(), ctx(fw.id))).json()
    expect(d.hasDraftParams).toBe(false)
    expect(d.effective.audio.bgmVolume).toBe(0.69)
  })

  it('框架不存在 → 404', async () => {
    expect((await GET(req(), ctx('00000000-0000-0000-0000-000000000000'))).status).toBe(404)
  })
})

describe('PATCH /api/frameworks/[id]/params', () => {
  it('写进 overlayTemplate.__templateParams', async () => {
    const fw = await makeFramework()
    expect((await PATCH(req({ audio: { bgmVolume: 0.3 } }), ctx(fw.id))).status).toBe(200)
    expect((await overlayOf(fw.id)).__templateParams).toEqual({ audio: { bgmVolume: 0.3 } })
  })

  // ★ 局部更新。整份替换会把草稿解析出的其余参数（分镜时长、转场序列、文字位置…）
  // 全部抹掉——那是这个框架"复刻同款风格"的全部依据。
  it('局部更新，不动没提到的字段', async () => {
    const fw = await makeFramework({
      __templateParams: { mode: 'flash', body: { slotDurationsMs: [5703, 8064] }, audio: { bgmVolume: 0.69 } },
    })
    await PATCH(req({ audio: { bgmVolume: 0.3 } }), ctx(fw.id))
    const tp = (await overlayOf(fw.id)).__templateParams as Record<string, unknown>
    expect(tp.mode).toBe('flash')
    expect((tp.body as Record<string, unknown>).slotDurationsMs).toEqual([5703, 8064])
    expect((tp.audio as Record<string, unknown>).bgmVolume).toBe(0.3)
  })

  // ★ overlayTemplate 里还挂着 __style / __imageSlots / __bookCount / __defaultBgmId
  // 等一堆别的配置，它们与剪辑参数无关，绝不能被踩掉。
  it('overlayTemplate 里的其它键原样保留', async () => {
    const fw = await makeFramework({ __style: 'warm', __imageSlots: [{ prompt: 'x' }], __bookCount: 9 })
    await PATCH(req({ audio: { bgmVolume: 0.3 } }), ctx(fw.id))
    const ot = await overlayOf(fw.id)
    expect(ot.__style).toBe('warm')
    expect(ot.__imageSlots).toEqual([{ prompt: 'x' }])
    expect(ot.__bookCount).toBe(9)
  })

  // 白名单与任务级共用同一个 sanitizeParamsOverride：两处能调的字段必须完全一致，
  // 否则会出现「工作台里调得了、框架里调不了」这种说不清的差别。
  it('死字段一律不收 → 400，且不写库', async () => {
    const fw = await makeFramework({ __style: 'warm' })
    expect((await PATCH(req({ body: { kenBurns: 'off' }, motion: { moves: ['push-in'] } }), ctx(fw.id))).status).toBe(400)
    expect((await overlayOf(fw.id)).__templateParams).toBeUndefined()
  })

  it('转场类型一律归一成叠化，硬切用时长 0 表达', async () => {
    const fw = await makeFramework()
    await PATCH(req({ transition: { bodyCycle: [{ renderType: 'wipe', durationMs: 500 }, { durationMs: 0 }] } }), ctx(fw.id))
    const tp = (await overlayOf(fw.id)).__templateParams as Record<string, unknown>
    expect((tp.transition as Record<string, unknown>).bodyCycle).toEqual([
      { renderType: 'crossfade', durationMs: 500 },
      { renderType: 'crossfade', durationMs: 0 },
    ])
  })

  it('非运营 → 403', async () => {
    const { HttpError } = await import('@/lib/auth')
    requireRoleMock.mockRejectedValue(new HttpError(403, '无权限'))
    const fw = await makeFramework()
    expect((await PATCH(req({ audio: { bgmVolume: 0.3 } }), ctx(fw.id))).status).toBe(403)
  })

  it('框架不存在 → 404', async () => {
    expect((await PATCH(req({ audio: { bgmVolume: 0.3 } }), ctx('00000000-0000-0000-0000-000000000000'))).status).toBe(404)
  })
})
