import { describe, it, expect } from 'vitest'
import { parseAsrResult } from './asr'

describe('parseAsrResult', () => {
  it('从扁平 sentences 结构提取全文与句级时间戳（简化/测试友好形态）', () => {
    const raw = { sentences: [
      { text: '第一句', begin_time: 0, end_time: 1200 },
      { text: '第二句', begin_time: 1200, end_time: 2600 },
    ]}
    const r = parseAsrResult(raw)
    expect(r.fullText).toBe('第一句第二句')
    expect(r.sentences[1]).toEqual({ text: '第二句', startMs: 1200, endMs: 2600 })
  })

  it('从真实 DashScope 录音文件识别结果（transcripts[].sentences[]）提取全文与句级时间戳', () => {
    // 结构核对自官方文档 https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api
    // （Paraformer 与 qwen3-asr-flash-filetrans 的 transcription_url JSON 共用此结构）
    const raw = {
      file_url: 'https://example.com/audio.wav',
      transcripts: [
        {
          channel_id: 0,
          text: 'Hello world, 这里是阿里巴巴语音实验室。',
          sentences: [
            {
              begin_time: 100,
              end_time: 3820,
              text: 'Hello world, 这里是阿里巴巴语音实验室。',
              sentence_id: 1,
              words: [{ begin_time: 100, end_time: 596, text: 'Hello ', punctuation: '' }],
            },
          ],
        },
      ],
    }
    const r = parseAsrResult(raw)
    expect(r.fullText).toBe('Hello world, 这里是阿里巴巴语音实验室。')
    expect(r.sentences).toEqual([
      { text: 'Hello world, 这里是阿里巴巴语音实验室。', startMs: 100, endMs: 3820 },
    ])
  })
})
