import { prisma } from '@mixcut/db'

// 注册开关：默认关闭（邀请制）。读 smtp_config.id=1 的 registration_open，缺行→false。
export async function registrationOpen(): Promise<boolean> {
  const row = await prisma.smtpConfig.findUnique({ where: { id: 1 } })
  return row?.registrationOpen ?? false
}
