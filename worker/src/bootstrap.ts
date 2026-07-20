import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'
import { ensureBgm } from './ensureBgm'

// 生产环境初始化：仅创建一个管理员（来自环境变量）与 SMTP 配置行。
// 不创建任何演示学员/演示数据。幂等，可重复执行。
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim()
  const password = process.env.ADMIN_PASSWORD
  const nickname = process.env.ADMIN_NICKNAME?.trim() || '管理员'

  if (!email || !password) {
    console.log('[bootstrap] 未设置 ADMIN_EMAIL / ADMIN_PASSWORD，跳过管理员创建')
  } else {
    // 已存在则只确保角色为 operator，不覆盖已有密码（避免每次部署重置管理员密码）
    const user = await prisma.user.upsert({
      where: { email },
      update: { role: 'operator' },
      create: { email, account: email, nickname, passwordHash: bcrypt.hashSync(password, 10), role: 'operator' },
    })
    console.log(`[bootstrap] 管理员就绪：${user.email}`)
  }

  // 后台 SMTP 开关所需的配置行
  await prisma.smtpConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })

  // 内置默认 BGM 曲库（无指定时自动配乐）
  await ensureBgm()

  console.log('[bootstrap] 完成')
}

main().finally(() => prisma.$disconnect())
