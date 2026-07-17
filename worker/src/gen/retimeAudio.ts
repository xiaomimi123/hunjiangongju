import { spawnSync } from 'child_process'

export interface RetimeSegment {
  seqNo: number
  startMs: number
  endMs: number
}

/**
 * 构造「音频感知 re-timing」的 ffmpeg filter_complex：
 * 对单一音频输入 [0:a]，按 origTimings 逐段切片（atrim + asetpts 归零 PTS），
 * 段尾补 pads[i] 毫秒静音（apad），再按序 concat 成一路输出 [out]。
 * 纯函数（不跑 ffmpeg），便于单测；由 retimeAudio() 实际执行。
 */
export function buildRetimeFilterComplex(origTimings: RetimeSegment[], pads: number[]): string {
  const n = origTimings.length
  if (n === 0) throw new Error('buildRetimeFilterComplex: origTimings 不能为空')
  if (pads.length !== n) {
    throw new Error(`buildRetimeFilterComplex: pads 长度(${pads.length}) 与 timings 长度(${n}) 不符`)
  }

  const segFilters: string[] = []
  const labels: string[] = []
  origTimings.forEach((t, i) => {
    const startSec = (t.startMs / 1000).toFixed(3)
    const endSec = (t.endMs / 1000).toFixed(3)
    const padSec = (Math.max(0, pads[i]) / 1000).toFixed(3)
    const label = `p${i}`
    segFilters.push(
      `[0:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS,apad=pad_dur=${padSec}[${label}]`,
    )
    labels.push(`[${label}]`)
  })
  segFilters.push(`${labels.join('')}concat=n=${n}:v=0:a=1[out]`)
  return segFilters.join(';')
}

/**
 * 把 audioAbs（连续的 full_audio.wav）按 origTimings 切片 + 逐段补 pads[i] 毫秒静音，
 * 拼接写出到 outAbs。仅在「确实应用了源节奏」时由调用方触发；
 * 无 pace 的 mock/旧任务路径不应调用本函数（保持 fullAudioUrl 原样不变）。
 */
export function retimeAudio(opts: {
  audioAbs: string
  outAbs: string
  origTimings: RetimeSegment[]
  pads: number[]
}): void {
  const { audioAbs, outAbs, origTimings, pads } = opts
  const filter = buildRetimeFilterComplex(origTimings, pads)
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-i', audioAbs, '-filter_complex', filter, '-map', '[out]', outAbs],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) {
    throw new Error(`ffmpeg 音频 re-timing 失败 (code ${r.status}): ${(r.stderr ?? r.stdout ?? '').slice(-800)}`)
  }
}
