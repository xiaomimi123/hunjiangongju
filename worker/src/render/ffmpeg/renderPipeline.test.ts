// prepareFontsDir 的单测：只测「自定义字体接不接得进 per-task fontsdir」这条边，
// 不碰 ffmpeg（那部分已有 renderPipeline.e2e.test.ts 真渲验收）。
//
// customFont 查库能力做成可注入参数（见 renderPipeline.ts 的 CustomFontLookup），
// 这里全程喂假实现，不需要真数据库。

import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, promises as fsp } from 'fs'
import os from 'os'
import path from 'path'

// ★ DATA_DIR 必须赶在任何 import 之前钉死——paths.ts 在模块加载时读环境变量。
// worker 是 CJS，不能用顶层 await；vi.hoisted 会被提升到所有 import 之前执行，
// 同 generateTts.e2e.test.ts 的手法。
const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/mixcut-fontsdata-${process.pid}`
  process.env.DATA_DIR = dir
  return dir
})

import { prepareFontsDir, type CustomFontLookup } from './renderPipeline'
import { DEFAULT_FONT_ID } from '@mixcut/db'

function mkHfDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'mixcut-fontsdir-'))
}

type FontRow = { id: string; label: string; family: string; weight: number; fileName: string }

function fakeLookup(rows: FontRow[]): CustomFontLookup & { findMany: ReturnType<typeof vi.fn<[{ where: { id: { in: string[] } } }], Promise<FontRow[]>>> } {
  const findMany = vi.fn(async (args: { where: { id: { in: string[] } } }) =>
    rows.filter((r) => args.where.id.in.includes(r.id)),
  )
  return { findMany }
}

describe('prepareFontsDir —— 自定义字体接入 per-task fontsdir', () => {
  it('自定义 id 能拷进目录，且族名/字重原样回传', async () => {
    const hfDir = mkHfDir()
    try {
      const lookup = fakeLookup([
        { id: 'cust1', label: '我的字体', family: 'My Custom Font', weight: 400, fileName: 'custom.ttf' },
      ])
      // data/fonts/ 下备好源文件
      const srcDir = path.join(dataDir, 'fonts')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(path.join(srcDir, 'custom.ttf'), 'fake-ttf-bytes')

      const { dir, fontFamilies } = await prepareFontsDir(hfDir, ['cust1'], lookup)

      const files = await fsp.readdir(dir)
      expect(files).toContain('custom.ttf')
      expect(fontFamilies).toEqual({ cust1: { family: 'My Custom Font', weight: 400 } })
    } finally {
      rmSync(hfDir, { recursive: true, force: true })
    }
  })

  it('内置字体照旧处理：默认字体恒在，与自定义字体互不干扰', async () => {
    const hfDir = mkHfDir()
    try {
      const lookup = fakeLookup([])
      const { dir, fontFamilies } = await prepareFontsDir(hfDir, [DEFAULT_FONT_ID], lookup)
      const files = await fsp.readdir(dir)
      expect(files).toContain('NotoSansSC-Regular.otf')
      expect(fontFamilies).toEqual({})
      // 认得出的内置 id 不该进 findMany 的查询参数里，甚至不必查库
      expect(lookup.findMany).not.toHaveBeenCalled()
    } finally {
      rmSync(hfDir, { recursive: true, force: true })
    }
  })

  it('库里有记录但磁盘上文件缺失：响亮失败，不静默跳过', async () => {
    const hfDir = mkHfDir()
    try {
      const lookup = fakeLookup([
        { id: 'cust-missing', label: '丢了的字体', family: 'Ghost Font', weight: 400, fileName: 'ghost-does-not-exist.ttf' },
      ])
      await expect(prepareFontsDir(hfDir, ['cust-missing'], lookup)).rejects.toThrow()
    } finally {
      rmSync(hfDir, { recursive: true, force: true })
    }
  })

  it('批量查库只发一次请求，即便多个字段各配了不同的自定义字体', async () => {
    const hfDir = mkHfDir()
    try {
      const srcDir = path.join(dataDir, 'fonts')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(path.join(srcDir, 'a.ttf'), 'a')
      writeFileSync(path.join(srcDir, 'b.ttf'), 'b')
      const lookup = fakeLookup([
        { id: 'cust-a', label: 'A', family: 'Font A', weight: 400, fileName: 'a.ttf' },
        { id: 'cust-b', label: 'B', family: 'Font B', weight: 700, fileName: 'b.ttf' },
      ])

      const { fontFamilies } = await prepareFontsDir(hfDir, ['cust-a', 'cust-b', 'cust-a'], lookup)

      expect(lookup.findMany).toHaveBeenCalledTimes(1)
      const arg = lookup.findMany.mock.calls[0]![0] as { where: { id: { in: string[] } } }
      expect(new Set(arg.where.id.in)).toEqual(new Set(['cust-a', 'cust-b']))
      expect(fontFamilies).toEqual({
        'cust-a': { family: 'Font A', weight: 400 },
        'cust-b': { family: 'Font B', weight: 700 },
      })
    } finally {
      rmSync(hfDir, { recursive: true, force: true })
    }
  })
})
