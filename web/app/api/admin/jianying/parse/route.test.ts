import { describe, it, expect, vi, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const { POST } = await import('./route')

function req(body: unknown) {
  return new NextRequest('http://localhost/api/admin/jianying/parse', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

// 与 packages/db parseJianyingDraft.test.ts 同款夹具：含《活着》书名快闪 + flash 配方核心字段。
const draft = {
  canvas_config: { width: 720, height: 960 },
  duration: 24601783,
  materials: {
    texts: [
      { id: 't_title', content: JSON.stringify({ text: '今天分享的是', styles: [{ font: { path: 'text/x/字由玄真.ttf' }, fill: { content: { solid: { color: [0, 0, 0] } } } }] }) },
      { id: 't_b1', content: JSON.stringify({ text: '《活着》', styles: [{ font: { path: 'text/x/字由玄真.ttf' }, fill: { content: { solid: { color: [0, 0, 0] } } } }] }) },
      { id: 't_sub', content: JSON.stringify({ text: '没有人能替你抚平情绪', styles: [{ font: { path: 'text/y/莫雪体.ttf' }, fill: { content: { solid: { color: [1, 1, 1] } } } }] }) },
    ],
    material_animations: [{ id: 'a1', animations: [{ name: '破镜重圆' }] }],
    transitions: [{ id: 'tr1', name: '叠化', duration: 500000 }],
    audios: [
      { id: 'au_bgm', name: '歌曲20260702' }, { id: 'au_gear', name: '发条旋钮转动齿轮' }, { id: 'au_drop', name: '一滴水滴声' },
    ],
  },
  tracks: [
    { type: 'video', segments: [{ target_timerange: { duration: 2158988 } }, { target_timerange: { duration: 3000000 } }] },
    { type: 'audio', segments: [{ material_id: 'au_bgm', volume: 0.692, target_timerange: { start: 0, duration: 20000000 } }] },
    { type: 'audio', segments: [{ material_id: 'au_gear', target_timerange: { start: 2158988, duration: 1800000 } }] },
    { type: 'audio', segments: [{ material_id: 'au_drop', volume: 0.51, target_timerange: { start: 3984033, duration: 500000 } }] },
    { type: 'sticker', segments: [
      { material_id: 't_title', target_timerange: { start: 0, duration: 2158988 }, clip: { transform: { y: -0.62 } }, extra_material_refs: ['a1'] },
      { material_id: 't_b1', target_timerange: { start: 2158988, duration: 150300 }, clip: { transform: { y: 0.66 } }, extra_material_refs: [] },
      { material_id: 't_sub', target_timerange: { start: 15509000, duration: 2321000 }, clip: { transform: { y: -0.486 } }, extra_material_refs: [] },
    ] },
  ],
}

describe('POST /api/admin/jianying/parse', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await POST(req({ draftJson: draft }), { params: {} })
    expect([401, 403]).toContain(res.status)
  })

  it('缺 draftJson → 400', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(req({}), { params: {} })
    expect(res.status).toBe(400)
  })

  it('合法 draft_content.json → 200，templateParams.mode=flash，meta.bookTitles 含活着', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(req({ draftJson: draft }), { params: {} })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.templateParams.mode).toBe('flash')
    expect(json.meta.bookTitles).toContain('活着')
  })

  it('draftJson 是不合法 JSON 字符串 → 400 明确提示', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    const res = await POST(req({ draftJson: '{not json' }), { params: {} })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('draft_content.json')
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})
