import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { TTS_VOICES } from '@mixcut/db'
import { HttpError } from '@/lib/auth'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const getCapabilityConfigMock = vi.fn()
vi.mock('@mixcut/db', async () => {
  const actual = await vi.importActual<typeof import('@mixcut/db')>('@mixcut/db')
  return { ...actual, getCapabilityConfig: (...args: unknown[]) => getCapabilityConfigMock(...args) }
})

const { GET } = await import('./route')

function req() {
  return new NextRequest('http://localhost/api/tts/voices', { method: 'GET' })
}
function cfg(extra: Record<string, unknown>) {
  return { capability: 'tts' as const, baseUrl: '', apiKey: '', model: '', enabled: false, extra }
}

describe('GET /api/tts/voices', () => {
  it('非 operator → 401/403', async () => {
    requireRoleMock.mockRejectedValueOnce(new HttpError(403, '无权限'))
    const res = await GET(req(), { params: {} })
    expect([401, 403]).toContain(res.status)
  })

  it('无 customVoices → 仅返回内置清单', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    getCapabilityConfigMock.mockResolvedValueOnce(cfg({}))
    const res = await GET(req(), { params: {} })
    const json = await res.json()
    expect(json.voices).toEqual(TTS_VOICES)
  })

  it('合法 customVoices 追加到清单末尾', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    getCapabilityConfigMock.mockResolvedValueOnce(
      cfg({ customVoices: [{ id: 'S_abc123', label: '我的对标男声' }] }),
    )
    const res = await GET(req(), { params: {} })
    const json = await res.json()
    expect(json.voices).toEqual([...TTS_VOICES, { id: 'S_abc123', label: '我的对标男声' }])
  })

  it('非法条目（id 不合法/label 缺失/label 空串）静默跳过，不影响合法条目', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    getCapabilityConfigMock.mockResolvedValueOnce(
      cfg({
        customVoices: [
          { id: '乱填', label: '中文id非法' },
          { id: 'ab', label: '太短' },
          { id: 'S_ok1', label: '' },
          { id: 'S_ok2' },
          { id: 'S_good', label: '合法条目' },
        ],
      }),
    )
    const res = await GET(req(), { params: {} })
    const json = await res.json()
    expect(json.voices).toEqual([...TTS_VOICES, { id: 'S_good', label: '合法条目' }])
  })

  it('customVoices 里 id 与内置重复 → 内置优先，不重复出现', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    getCapabilityConfigMock.mockResolvedValueOnce(
      cfg({ customVoices: [{ id: TTS_VOICES[0].id, label: '覆盖尝试' }] }),
    )
    const res = await GET(req(), { params: {} })
    const json = await res.json()
    expect(json.voices).toEqual(TTS_VOICES)
  })

  it('customVoices 非数组 → 忽略，仅返回内置清单', async () => {
    requireRoleMock.mockResolvedValueOnce({ userId: 'op1', role: 'operator' })
    getCapabilityConfigMock.mockResolvedValueOnce(cfg({ customVoices: 'not-an-array' }))
    const res = await GET(req(), { params: {} })
    const json = await res.json()
    expect(json.voices).toEqual(TTS_VOICES)
  })
})
