import path from 'path'
import fs from 'fs/promises'
import ffmpeg from 'fluent-ffmpeg'
import bcrypt from 'bcryptjs'
import { prisma, splitScript } from '@mixcut/db'
import { DATA_DIR } from './paths'

async function genVideo(out: string, opts: { color: string; label: string; w: number; h: number; freq: number }) {
  const { color, label, w, h, freq } = opts
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(`color=c=${color}:s=${w}x${h}:d=6`).inputFormat('lavfi')
      .input(`sine=frequency=${freq}:duration=6`).inputFormat('lavfi')
      .outputOptions([
        '-vf', `drawtext=text='${label}':font='Noto Sans CJK SC':fontsize=${Math.round(h / 8)}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100',
      ])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

async function makeThumb(video: string, outJpg: string) {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(video).inputOptions(['-ss', '0.5'])
      .outputOptions(['-frames:v', '1', '-vf', 'scale=320:-2'])
      .output(outJpg).on('end', () => resolve()).on('error', reject).run()
  })
}

async function main() {
  // 1. 用户（邮箱账号）
  const op = await prisma.user.upsert({
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

  // 2. 标签树（幂等：已存在则跳过）
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
  }
  const leaf = async (name: string) =>
    (await prisma.tagCategory.findFirstOrThrow({ where: { name, parentId: { not: null } } })).id

  // 3. 测试素材（12 条；注意：不给"小说类"挂任何素材，用于验证 MATERIAL_PENDING）
  if ((await prisma.material.count()) === 0) {
    const colors = ['0x8E44AD', '0x2980B9', '0x27AE60', '0xD35400', '0xC0392B', '0x16A085']
    const specs: { tags: string[] }[] = [
      { tags: ['书房/阅读角', '育儿类', '自然口播'] },
      { tags: ['书房/阅读角', '养生类'] },
      { tags: ['户外', '育儿类', '情绪煽动'] },
      { tags: ['户外', '养生类', '自然口播'] },
      { tags: ['产品特写', '育儿类'] },
      { tags: ['产品特写', '养生类', '情绪煽动'] },
      { tags: ['讲解人出镜', '育儿类', '自然口播'] },
      { tags: ['讲解人出镜', '养生类'] },
      { tags: ['无人出镜', '产品特写', '育儿类'] },
      { tags: ['无人出镜', '户外'] },
      { tags: ['书房/阅读角', '讲解人出镜', '情绪煽动'] },
      { tags: ['产品特写', '无人出镜', '自然口播'] },
    ]
    await fs.mkdir(path.join(DATA_DIR, 'materials'), { recursive: true })
    for (const [i, spec] of specs.entries()) {
      const vertical = i % 2 === 0
      const name = `seed-${String(i + 1).padStart(2, '0')}`
      const abs = path.join(DATA_DIR, 'materials', `${name}.mp4`)
      await genVideo(abs, {
        color: colors[i % colors.length],
        label: `素材${i + 1}`,
        w: vertical ? 720 : 1280,
        h: vertical ? 1280 : 720,
        freq: 300 + i * 40,
      })
      await makeThumb(abs, path.join(DATA_DIR, 'materials', `${name}.jpg`))
      const tagIds = await Promise.all(spec.tags.map(leaf))
      await prisma.material.create({
        data: {
          fileUrl: `/api/files/materials/${name}.mp4`,
          thumbnailUrl: `/api/files/materials/${name}.jpg`,
          durationMs: 6000,
          uploadedBy: op.id,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
      })
      console.log(`[seed] material ${name} 生成完毕`)
    }
  }

  // 4. 示例文案（分段 + 打标签 + 发布）
  if ((await prisma.script.count()) === 0) {
    const scripts: { title: string; content: string; segTags: string[][] }[] = [
      {
        title: '育儿好物推荐',
        content: '当妈妈之后才知道，选对绘本有多重要\n这套书我家娃反复翻了一个月都不腻\n画面精美内容也有深度，性价比真的高\n现在下单还有活动价，链接就在下方',
        segTags: [
          ['讲解人出镜', '育儿类', '自然口播'],
          ['书房/阅读角', '育儿类'],
          ['产品特写', '育儿类'],
          ['产品特写', '育儿类', '情绪煽动'],
        ],
      },
      {
        title: '神秘小说安利',
        content: '这本悬疑小说我一口气读到凌晨三点\n反转多到你根本猜不到结局\n喜欢烧脑的书友千万别错过',
        segTags: [
          ['书房/阅读角', '小说类'],
          ['小说类', '情绪煽动'],
          ['产品特写', '小说类'],
        ],
      },
    ]
    for (const s of scripts) {
      const script = await prisma.script.create({
        data: { title: s.title, content: s.content, status: 'published', createdBy: op.id },
      })
      const parts = splitScript(s.content)
      for (const [i, text] of parts.entries()) {
        const seg = await prisma.scriptSegment.create({
          data: { scriptId: script.id, seqNo: i + 1, text },
        })
        const tagIds = await Promise.all((s.segTags[i] ?? []).map(leaf))
        await prisma.segmentTag.createMany({
          data: tagIds.map((tagId) => ({ segmentId: seg.id, tagId })),
        })
      }
      console.log(`[seed] script 《${s.title}》 完成`)
    }
  }

  console.log('[seed] 全部完成')
}

main().finally(() => prisma.$disconnect())
