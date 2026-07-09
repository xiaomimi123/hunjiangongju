import ffmpeg from 'fluent-ffmpeg'

export function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) return reject(err)
      resolve(Math.round((data.format.duration ?? 0) * 1000))
    })
  })
}

export function makeThumbnail(video: string, outJpg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .inputOptions(['-ss', '0.5'])
      .outputOptions(['-frames:v', '1', '-vf', 'scale=320:-2'])
      .output(outJpg)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}
