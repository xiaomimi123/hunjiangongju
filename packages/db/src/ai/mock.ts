// 极小合法 PNG（1x1 红点）与极短静音 WAV，供 P1 图/音步骤在 mock 下也能跑 ffmpeg
export function mockLlm(prompt: string): string {
  // 返回 3 段短文案，便于分段/校验联调
  return ['这是第一段模拟文案。', '这是第二段模拟文案。', '这是第三段模拟文案。'].join('\n')
}

export function mockImagePng(): Buffer {
  // 1x1 红色 PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

export function mockSilentWav(seconds = 1): Buffer {
  const sampleRate = 8000
  const numSamples = sampleRate * seconds
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40)
  return buf // 剩余为 0 = 静音
}

export function mockAsr() {
  return {
    fullText: '这是模拟转写的第一句。这是第二句。这是第三句。',
    sentences: [
      { text: '这是模拟转写的第一句。', startMs: 0, endMs: 2000 },
      { text: '这是第二句。', startMs: 2000, endMs: 3500 },
      { text: '这是第三句。', startMs: 3500, endMs: 5000 },
    ],
  }
}
