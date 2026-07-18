import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@mixcut/db'
import { DATA_DIR } from './paths'

// 内置 3 首柔和氛围 pad（ffmpeg 合成，无版权顾虑），作为「无指定 BGM 时自动配乐」的默认曲库。
// 用户可在后台上传替换为正式授权音乐。幂等：曲库已有可用文件则跳过。
const PADS: { id: string; tag: string; freqs: [number, number, number] }[] = [
  { id: 'bgm-warm', tag: '温暖', freqs: [261.6, 329.6, 392] },
  { id: 'bgm-heal', tag: '治愈', freqs: [220, 277.2, 329.6] },
  { id: 'bgm-calm', tag: '沉思', freqs: [293.7, 349.2, 440] },
]

function genPad(freqs: [number, number, number], outAbs: string): boolean {
  const inputs = freqs.flatMap((f) => ['-f', 'lavfi', '-i', `sine=frequency=${f}:duration=90`])
  const r = spawnSync(
    'ffmpeg',
    [
      '-y', ...inputs,
      '-filter_complex',
      '[0][1][2]amix=inputs=3:normalize=1,tremolo=f=0.12:d=0.35,lowpass=f=1400,aecho=0.8:0.7:60:0.3,afade=t=in:d=2,afade=t=out:st=87:d=3,volume=0.9',
      '-c:a', 'libmp3lame', '-q:a', '5', '-t', '90', outAbs,
    ],
    { encoding: 'utf8' },
  )
  return r.status === 0
}

export async function ensureBgm(): Promise<void> {
  const dir = path.join(DATA_DIR, 'bgm')
  await fs.mkdir(dir, { recursive: true })

  // 已有可用曲目（文件真实存在且非占位）→ 跳过
  const existing = await prisma.bgmLibrary.findMany({ select: { id: true, fileUrl: true } })
  for (const b of existing) {
    const rel = b.fileUrl.replace(/^\/api\/files\//, '')
    const abs = path.join(DATA_DIR, rel)
    const ok = await fs.stat(abs).then((s) => s.size > 10_000).catch(() => false)
    if (ok) {
      console.log('[bootstrap] BGM 曲库已就绪，跳过生成')
      return
    }
  }

  let n = 0
  for (const p of PADS) {
    const abs = path.join(dir, `${p.id}.mp3`)
    if (!genPad(p.freqs, abs)) {
      console.warn(`[bootstrap] 生成 BGM ${p.id} 失败（缺 ffmpeg?），跳过`)
      continue
    }
    await prisma.bgmLibrary.upsert({
      where: { id: p.id },
      update: { fileUrl: `/api/files/bgm/${p.id}.mp3`, styleTag: p.tag, durationMs: 90_000 },
      create: { id: p.id, fileUrl: `/api/files/bgm/${p.id}.mp3`, styleTag: p.tag, durationMs: 90_000 },
    })
    n++
  }
  console.log(`[bootstrap] 生成内置 BGM ${n} 首`)
}
