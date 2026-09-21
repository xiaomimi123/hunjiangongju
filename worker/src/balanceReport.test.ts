import { describe, it, expect } from 'vitest'
import { buildReport, msUntilNextSend } from './balanceReport'
import { parsePhotoBalance } from '@mixcut/db'

describe('parsePhotoBalance', () => {
  it('真实余额', () => {
    expect(parsePhotoBalance({ remain_balance: 3.5, used_balance: 9.47, unlimited_quota: false }))
      .toEqual({ unlimited: false, remainUsd: 3.5, usedUsd: 9.47 })
  })
  it('不限额 key（实测 apib.ai 返回 -1 + unlimited）', () => {
    const b = parsePhotoBalance({ remain_balance: -1, used_balance: 9.47, unlimited_quota: true })
    expect(b.unlimited).toBe(true)
    expect(b.remainUsd).toBeNull()
  })
})

describe('buildReport', () => {
  const stats = { okRuns: 10, okImages: 25, failedRuns: 2, consumedCc: 200 }
  it('余额充足：普通主题', () => {
    const r = buildReport({ unlimited: false, remainUsd: 20, usedUsd: 5 }, stats)
    expect(r.subject).not.toContain('告急')
    expect(r.html).toContain('$20.0000')
    expect(r.html).toContain('成功 10 次 / 25 张')
    expect(r.html).toContain('2.00 积分') // 200cc
  })
  it('余额低于告急线：主题带【告急】', () => {
    const r = buildReport({ unlimited: false, remainUsd: 0.04, usedUsd: 9.5 }, stats)
    expect(r.subject).toContain('【告急】')
    expect(r.html).toContain('请尽快充值')
  })
  it('查询失败：主题带【异常】并写明原因', () => {
    const r = buildReport({ error: '余额查询失败 500' }, stats)
    expect(r.subject).toContain('【异常】')
    expect(r.html).toContain('余额查询失败 500')
  })
  it('不限额：不告急', () => {
    const r = buildReport({ unlimited: true, remainUsd: null, usedUsd: null }, stats)
    expect(r.subject).not.toContain('告急')
    expect(r.html).toContain('不限额')
  })
})

describe('msUntilNextSend', () => {
  it('北京时间 08:00 → 1 小时后发', () => {
    // 2026-09-21 00:00 UTC = 北京 08:00
    const now = Date.UTC(2026, 8, 21, 0, 0, 0)
    expect(msUntilNextSend(now)).toBe(3600_000)
  })
  it('北京时间 09:00 整已过 → 明天 9 点（24h 后）', () => {
    const now = Date.UTC(2026, 8, 21, 1, 0, 0) // 北京 09:00
    expect(msUntilNextSend(now)).toBe(24 * 3600_000)
  })
  it('北京时间 23:00 → 10 小时后', () => {
    const now = Date.UTC(2026, 8, 21, 15, 0, 0) // 北京 23:00
    expect(msUntilNextSend(now)).toBe(10 * 3600_000)
  })
})
