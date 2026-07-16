import { promises as fs } from 'fs'
import path from 'path'
import { prisma, ttsSynthesize, setGenerationStatus, enqueueGen } from '@mixcut/db'
import { DATA_DIR } from '../paths'

export async function generateTts(genTaskId: string): Promise<void> {
  const segments = await prisma.generatedSegment.findMany({
    where: { generationTaskId: genTaskId },
    orderBy: { seqNo: 'asc' },
  })

  // 整篇文案拼接一次配音
  const text = segments.map((s) => s.scriptText).join('\n')
  const audio = await ttsSynthesize({ text })

  const dir = path.join(DATA_DIR, 'gen', genTaskId)
  await fs.mkdir(dir, { recursive: true })

  // P1 统一存 .wav（mock 返回静音 WAV；真实 mp3 亦兼容，下游 ffmpeg 探测读取）
  const abs = path.join(dir, 'full_audio.wav')
  await fs.writeFile(abs, audio)

  const fullAudioUrl = `/api/files/gen/${genTaskId}/full_audio.wav`
  await prisma.generationTask.update({
    where: { id: genTaskId },
    data: { fullAudioUrl },
  })

  await setGenerationStatus(genTaskId, 'CAPTION_ALIGNING')
  await enqueueGen('align-captions', { genTaskId })
}
