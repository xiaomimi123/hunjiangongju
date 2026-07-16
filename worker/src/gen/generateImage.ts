import { promises as fs } from 'fs'
import path from 'path'
import { prisma, imageGenerate, setGenerationStatus, enqueueGen } from '@mixcut/db'
import { DATA_DIR } from '../paths'

export async function generateImage(genTaskId: string): Promise<void> {
  const task = await prisma.generationTask.findUniqueOrThrow({
    where: { id: genTaskId },
    include: { framework: true },
  })
  const stylePrompt = task.framework.imageStylePrompt ?? ''

  const segments = await prisma.generatedSegment.findMany({
    where: { generationTaskId: genTaskId },
    orderBy: { seqNo: 'asc' },
  })

  const dir = path.join(DATA_DIR, 'gen', genTaskId)
  await fs.mkdir(dir, { recursive: true })

  for (const seg of segments) {
    // P1 固定风格前后缀：简单前缀拼接
    const prompt = [stylePrompt, seg.scriptText].filter(Boolean).join(' ')
    const png = await imageGenerate({ prompt, size: '720x960' })

    const abs = path.join(dir, `${seg.seqNo}.png`)
    await fs.writeFile(abs, png)

    const imageUrl = `/api/files/gen/${genTaskId}/${seg.seqNo}.png`
    await prisma.generatedSegment.update({
      where: { id: seg.id },
      data: { imageUrl },
    })
  }

  await setGenerationStatus(genTaskId, 'TTS_GENERATING')
  await enqueueGen('generate-tts', { genTaskId })
}
