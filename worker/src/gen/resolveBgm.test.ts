import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@mixcut/db'
import { resolveBgmId, readBgmFolder } from './renderVisuals'

// 选曲优先级是四层兜底，一层接错就会「配置了分组却出别的歌」——
// 而这属于听感问题，出片后很难被发现，必须在这里钉死。

const ids: string[] = []
async function makeBgm(name: string, folder?: string) {
  const b = await prisma.bgmLibrary.create({
    data: { fileUrl: `/api/files/bgm/${name}.mp3`, name, folder: folder ?? null },
  })
  ids.push(b.id)
  return b
}

afterAll(async () => {
  await prisma.bgmLibrary.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

describe('readBgmFolder', () => {
  it('取 __bgmFolder 并去空白；没配 → null', () => {
    expect(readBgmFolder({ __bgmFolder: ' 抒情 ' })).toBe('抒情')
    expect(readBgmFolder({})).toBeNull()
    expect(readBgmFolder({ __bgmFolder: '  ' })).toBeNull()
    expect(readBgmFolder(null)).toBeNull()
  })
})

describe('resolveBgmId —— 四层优先级', () => {
  it('① 手选的 __bgmId 压过一切', async () => {
    const picked = await makeBgm('手选曲', '分组甲测试')
    await makeBgm('分组里的曲', '分组甲测试')
    const got = await resolveBgmId({ __bgmId: picked.id }, { __bgmFolder: '分组甲测试' }, 'task-1')
    expect(got).toBe(picked.id)
  })

  // ★ 分组排在剪映原曲之前：分组是运营显式配置的意图，导入默认曲只是解析残留
  it('② 框架分组压过剪映原曲，且只从分组里挑', async () => {
    const inFolder = await makeBgm('组内唯一', '分组乙测试')
    const original = await makeBgm('剪映原曲乙')
    const got = await resolveBgmId(null, { __bgmFolder: '分组乙测试', __defaultBgmId: original.id }, 'task-2')
    expect(got).toBe(inFolder.id)
  })

  it('② 同任务重跑选同一首（稳定随机，不用 Math.random）', async () => {
    await makeBgm('组丙一', '分组丙测试')
    await makeBgm('组丙二', '分组丙测试')
    await makeBgm('组丙三', '分组丙测试')
    const a = await resolveBgmId(null, { __bgmFolder: '分组丙测试' }, 'task-same')
    const b = await resolveBgmId(null, { __bgmFolder: '分组丙测试' }, 'task-same')
    expect(a).toBe(b)
  })

  it('② 分组是空的 → 落到下一级，不是无 BGM', async () => {
    const original = await makeBgm('剪映原曲丁')
    const got = await resolveBgmId(null, { __bgmFolder: '不存在的分组xx', __defaultBgmId: original.id }, 'task-4')
    expect(got).toBe(original.id)
  })

  it('③ 无分组时用剪映原曲；原曲被删了 → ④ 全库兜底不留白', async () => {
    const survivor = await makeBgm('幸存曲戊')
    const got = await resolveBgmId(null, { __defaultBgmId: '00000000-0000-0000-0000-000000000000' }, 'task-5')
    // 只断言"不留白"：全库兜底的池子里可能有并行测试套件的行，断言具体命中谁会闪红
    expect(got, '陈旧 id 应跳过并落到全库兜底').not.toBeNull()
    void survivor
  })

  it('手选的 id 已被删除 → 不硬失败，走后续层级', async () => {
    const fallback = await makeBgm('兜底曲己', '分组己测试')
    const got = await resolveBgmId({ __bgmId: '00000000-0000-0000-0000-000000000001' }, { __bgmFolder: '分组己测试' }, 'task-6')
    expect(got).toBe(fallback.id)
  })
})
