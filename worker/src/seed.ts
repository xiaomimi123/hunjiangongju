import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'

// 开发/演示种子：仅创建演示用户（运营 + 学员）与 SMTP 配置行。
// v2.2 拆旧后不再有旧混剪演示数据（素材/标签/文案）。幂等，可重复执行。
async function main() {
  await prisma.user.upsert({
    where: { email: 'operator@demo.com' },
    update: {},
    create: { email: 'operator@demo.com', account: 'operator@demo.com', nickname: '运营小队', passwordHash: bcrypt.hashSync('op123456', 10), role: 'operator' },
  })
  for (const [n, name] of [['student1', '学员一'], ['student2', '学员二'], ['student3', '学员三']] as const) {
    await prisma.user.upsert({
      where: { email: `${n}@demo.com` },
      update: {},
      create: { email: `${n}@demo.com`, account: `${n}@demo.com`, nickname: name, passwordHash: bcrypt.hashSync('stu123456', 10), role: 'student' },
    })
  }
  await prisma.smtpConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })

  console.log('[seed] 全部完成')
}

main().finally(() => prisma.$disconnect())
