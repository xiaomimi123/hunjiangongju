import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@mixcut/db'
import { registrationOpen } from './registration'

describe('registrationOpen', () => {
  it('默认（未显式开启）为 false', async () => {
    await prisma.smtpConfig.upsert({ where: { id: 1 }, update: { registrationOpen: false }, create: { id: 1, registrationOpen: false } })
    expect(await registrationOpen()).toBe(false)
  })

  it('开启后返回 true', async () => {
    await prisma.smtpConfig.upsert({ where: { id: 1 }, update: { registrationOpen: true }, create: { id: 1, registrationOpen: true } })
    expect(await registrationOpen()).toBe(true)
  })

  it('关闭后恢复 false', async () => {
    await prisma.smtpConfig.update({ where: { id: 1 }, data: { registrationOpen: false } })
    expect(await registrationOpen()).toBe(false)
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})
