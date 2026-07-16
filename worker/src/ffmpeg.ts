import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs/promises'
import path from 'path'

export function probeHasAudio(file: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) return reject(err)
      resolve((data.streams ?? []).some((s) => s.codec_type === 'audio'))
    })
  })
}

export async function normalizeSegment(opts: {
  input: string; out: string; durationMs: number; w: number; h: number; isImage?: boolean
}): Promise<void> {
  const { input, out, durationMs, w, h, isImage } = opts
  // 图片没有音轨、用 -loop 1 循环成 N 秒；视频用 -stream_loop -1 循环补足时长
  const hasAudio = isImage ? false : await probeHasAudio(input)
  const sec = (durationMs / 1000).toFixed(3)
  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(input).inputOptions(isImage ? ['-loop', '1'] : ['-stream_loop', '-1'])
    if (!hasAudio) cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi')
    cmd
      .complexFilter([
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:5[bg]`,
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[v]`,
      ])
      .outputOptions([
        '-map', '[v]',
        '-map', hasAudio ? '0:a:0' : '1:a:0',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2',
        '-t', sec,
      ])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

/** 抽单声道 16k WAV 音频，供 ASR 使用 */
export function extractAudio(videoAbs: string, outWav: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoAbs)
      .outputOptions(['-vn', '-ac', '1', '-ar', '16000', '-y'])
      .output(outWav)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

export async function concatSegments(files: string[], out: string): Promise<void> {
  const listPath = path.join(path.dirname(out), 'concat-list.txt')
  await fs.writeFile(listPath, files.map((f) => `file '${f}'`).join('\n'))
  await new Promise<void>((resolve, reject) => {
    ffmpeg(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

export function burnSubtitles(video: string, srtPath: string, out: string): Promise<void> {
  const style = 'FontName=Noto Sans CJK SC,FontSize=14,Outline=1,MarginV=40'
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .outputOptions(['-vf', `subtitles=${srtPath}:force_style='${style}'`, '-c:a', 'copy'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

function runDetectFilter(file: string, kind: 'video' | 'audio', filter: string, marker: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    const cmd = ffmpeg(file)
    if (kind === 'video') cmd.outputOptions(['-vf', filter, '-an'])
    else cmd.outputOptions(['-af', filter, '-vn'])
    cmd
      .outputOptions(['-f', 'null'])
      .output('-')
      .on('stderr', (line: string) => { if (line.includes(marker)) lines.push(line.trim()) })
      .on('end', () => resolve(lines))
      .on('error', reject)
      .run()
  })
}

/** 场景检测：跑 scene filter + showinfo，返回合并的 stdout+stderr（showinfo 走 stderr） */
export function detectScenes(video: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    ffmpeg(video)
      .outputOptions(['-hide_banner', '-filter:v', "select='gt(scene,0.3)',showinfo", '-f', 'null'])
      .output('-')
      .on('stderr', (line: string) => { out += line + '\n' })
      .on('end', (stdout?: string | null) => resolve(out + (stdout ?? '')))
      .on('error', reject)
      .run()
  })
}

export function detectBlack(file: string): Promise<string[]> {
  return runDetectFilter(file, 'video', 'blackdetect=d=0.5:pix_th=0.10', 'black_start')
}

export function detectSilence(file: string): Promise<string[]> {
  return runDetectFilter(file, 'audio', 'silencedetect=noise=-50dB:d=1.0', 'silence_start')
}
