import ffmpeg from 'fluent-ffmpeg'

export function probeHasAudio(file: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) return reject(err)
      resolve((data.streams ?? []).some((s) => s.codec_type === 'audio'))
    })
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
