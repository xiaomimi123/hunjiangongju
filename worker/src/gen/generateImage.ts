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
    // 文案只作「画面意境」引导，绝不能把句子当文字画进图里（否则与字幕层叠字、乱码）。
    // 不提"书/书名/书页"等会诱导模型画出文字的词；只给情绪场景，配 negative_prompt 强力压制文字。
    const prompt = [stylePrompt, `一个能烘托这种情绪的安静场景：${seg.scriptText}`, '干净的纯画面场景，画面里不出现任何文字、书本上的字、招牌、字幕或水印']
      .filter(Boolean)
      .join('，')
    const png = await imageGenerate({
      prompt,
      size: '720x960',
      negativePrompt: '文字, 字, 汉字, 字母, 单词, 书法, 标题, 字幕, 水印, text, letters, words, caption, watermark, signature',
    })

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
