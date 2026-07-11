import bcrypt from 'bcryptjs'
import { prisma } from '@mixcut/db'

// 生产环境初始化：仅创建一个管理员（来自环境变量）、SMTP 配置行、标签树。
// 不创建任何演示学员/演示素材/演示文案。幂等，可重复执行。
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

  // 标签树（仅当为空时初始化）
  if ((await prisma.tagCategory.count()) === 0) {
    const tree: Record<string, string[]> = {
      场景: ['书房/阅读角', '户外', '产品特写'],
      人物: ['讲解人出镜', '无人出镜'],
      产品类型: ['育儿类', '养生类', '小说类'],
      情绪基调: ['自然口播', '情绪煽动'],
    }
    for (const [root, children] of Object.entries(tree)) {
      const parent = await prisma.tagCategory.create({ data: { name: root } })
      for (const [i, name] of children.entries()) {
        await prisma.tagCategory.create({ data: { name, parentId: parent.id, sortOrder: i + 1 } })
      }
    }
    console.log('[bootstrap] 标签树初始化完成')
  }

  console.log('[bootstrap] 完成')
}

main().finally(() => prisma.$disconnect())
