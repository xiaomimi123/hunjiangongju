import { promises as fs } from 'fs'
import path from 'path'
import { prisma, ttsSynthesize, setGenerationStatus, enqueueGen } from '@mixcut/db'
import { DATA_DIR } from '../paths'

// 纯函数：从 GenerationTask.variables（Json）中取出运营在生成表单里选的克隆音色 voiceId。
// 未选（或格式不对）时返回 undefined，此时 ttsSynthesize 走原有通用音色分支，行为不变。
export function readVoiceId(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return undefined
  const voiceId = (variables as Record<string, unknown>).voiceId
  return typeof voiceId === 'string' && voiceId.trim() ? voiceId.trim() : undefined
}

export async function generateTts(genTaskId: string): Promise<void> {
  const [task, segments] = await Promise.all([
    prisma.generationTask.findUnique({ where: { id: genTaskId }, select: { variables: true } }),
    prisma.generatedSegment.findMany({
      where: { generationTaskId: genTaskId },
      orderBy: { seqNo: 'asc' },
    }),
  ])

  // 整篇文案拼接一次配音
  const text = segments.map((s) => s.scriptText).join('\n')
  const voiceId = readVoiceId(task?.variables)
  const audio = await ttsSynthesize({ text, ...(voiceId ? { voiceId } : {}) })

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
