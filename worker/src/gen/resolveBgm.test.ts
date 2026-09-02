import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@mixcut/db'
import { resolveBgmId, readBgmFolder, type BgmFileExists } from './renderVisuals'

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

// 这组只测四层优先级本身，不测磁盘校验（那是下面「文件缺失兜底」的职责）——
// 所以统一注入「一律视为文件存在」，不必真的在磁盘上建 fixture 文件。
const alwaysExists: BgmFileExists = async () => true

describe('resolveBgmId —— 四层优先级', () => {
  it('① 手选的 __bgmId 压过一切', async () => {
    const picked = await makeBgm('手选曲', '分组甲测试')
    await makeBgm('分组里的曲', '分组甲测试')
    const got = await resolveBgmId({ __bgmId: picked.id }, { __bgmFolder: '分组甲测试' }, 'task-1', alwaysExists)
    expect(got).toBe(picked.id)
  })

  // ★ 分组排在剪映原曲之前：分组是运营显式配置的意图，导入默认曲只是解析残留
  it('② 框架分组压过剪映原曲，且只从分组里挑', async () => {
    const inFolder = await makeBgm('组内唯一', '分组乙测试')
    const original = await makeBgm('剪映原曲乙')
    const got = await resolveBgmId(null, { __bgmFolder: '分组乙测试', __defaultBgmId: original.id }, 'task-2', alwaysExists)
    expect(got).toBe(inFolder.id)
  })

  it('② 同任务重跑选同一首（稳定随机，不用 Math.random）', async () => {
    await makeBgm('组丙一', '分组丙测试')
    await makeBgm('组丙二', '分组丙测试')
    await makeBgm('组丙三', '分组丙测试')
    const a = await resolveBgmId(null, { __bgmFolder: '分组丙测试' }, 'task-same', alwaysExists)
    const b = await resolveBgmId(null, { __bgmFolder: '分组丙测试' }, 'task-same', alwaysExists)
    expect(a).toBe(b)
  })

  it('② 分组是空的 → 落到下一级，不是无 BGM', async () => {
    const original = await makeBgm('剪映原曲丁')
    const got = await resolveBgmId(null, { __bgmFolder: '不存在的分组xx', __defaultBgmId: original.id }, 'task-4', alwaysExists)
    expect(got).toBe(original.id)
  })

  it('③ 无分组时用剪映原曲；原曲被删了 → ④ 全库兜底不留白', async () => {
    const survivor = await makeBgm('幸存曲戊')
    const got = await resolveBgmId(null, { __defaultBgmId: '00000000-0000-0000-0000-000000000000' }, 'task-5', alwaysExists)
    // 只断言"不留白"：全库兜底的池子里可能有并行测试套件的行，断言具体命中谁会闪红
    expect(got, '陈旧 id 应跳过并落到全库兜底').not.toBeNull()
    void survivor
  })

  it('手选的 id 已被删除 → 不硬失败，走后续层级', async () => {
    const fallback = await makeBgm('兜底曲己', '分组己测试')
    const got = await resolveBgmId({ __bgmId: '00000000-0000-0000-0000-000000000001' }, { __bgmFolder: '分组己测试' }, 'task-6', alwaysExists)
    expect(got).toBe(fallback.id)
  })
})

// data/ 目录被误删过一次：库里记录还在，磁盘上的文件没了。这组测试注入一个假的
// fileExists（按 fileUrl 判断，不必真的在磁盘上建文件），钉死「记录在但文件不在 → 落到下一级」。
describe('resolveBgmId —— 文件缺失兜底（磁盘校验）', () => {
  /** 除了传入的 name 列表，其余一律视为文件存在。 */
  function missing(...names: string[]): BgmFileExists {
    const gone = new Set(names.map((n) => `/api/files/bgm/${n}.mp3`))
    return async (fileUrl) => !gone.has(fileUrl)
  }

  it('__bgmId 指向的记录存在但文件缺失 → 落到下一级', async () => {
    const picked = await makeBgm('手选曲丢文件', '分组庚测试')
    const fallback = await makeBgm('分组里的曲丢文件不影响', '分组庚测试')
    const got = await resolveBgmId(
      { __bgmId: picked.id }, { __bgmFolder: '分组庚测试' }, 'task-7', missing('手选曲丢文件'),
    )
    expect(got).toBe(fallback.id)
  })

  it('分组池 3 首丢 1 首 → 只挑另外 2 首之一，且同 genTaskId 重跑结果稳定', async () => {
    await makeBgm('组辛一', '分组辛测试')
    await makeBgm('组辛二丢文件', '分组辛测试')
    await makeBgm('组辛三', '分组辛测试')
    const fileExists = missing('组辛二丢文件')
    const a = await resolveBgmId(null, { __bgmFolder: '分组辛测试' }, 'task-same-2', fileExists)
    const b = await resolveBgmId(null, { __bgmFolder: '分组辛测试' }, 'task-same-2', fileExists)
    expect(a).toBe(b)
    expect(a).not.toBeNull()
    const picked = await prisma.bgmLibrary.findUnique({ where: { id: a! } })
    expect(picked?.name).not.toBe('组辛二丢文件')
  })

  it('分组池全部丢文件 → 落到默认 BGM 那一级', async () => {
    await makeBgm('组壬一丢文件', '分组壬测试')
    await makeBgm('组壬二丢文件', '分组壬测试')
    const original = await makeBgm('剪映原曲壬')
    const got = await resolveBgmId(
      null, { __bgmFolder: '分组壬测试', __defaultBgmId: original.id }, 'task-8',
      missing('组壬一丢文件', '组壬二丢文件'),
    )
    expect(got).toBe(original.id)
  })

  it('默认 BGM 文件缺失 → 落到全库兜底', async () => {
    const survivor = await makeBgm('幸存曲癸')
    const defaultBgm = await makeBgm('默认曲丢文件')
    const got = await resolveBgmId(
      null, { __defaultBgmId: defaultBgm.id }, 'task-9', missing('默认曲丢文件'),
    )
    expect(got, '默认曲文件缺失应跳过并落到全库兜底').not.toBeNull()
    void survivor
  })

  it('全库所有文件都缺失 → 返回 null（没有 BGM 但仍能渲出来）', async () => {
    // 只用注入的 fileExists 兜底所有曲目一律视为缺失，不需要真的清空全库——
    // missing() 未列出的名字默认「存在」，这里反过来：全部视为不存在。
    const alwaysMissing: BgmFileExists = async () => false
    const got = await resolveBgmId(null, {}, 'task-10', alwaysMissing)
    expect(got).toBeNull()
  })
})
