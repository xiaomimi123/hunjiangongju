import { describe, it, expect } from 'vitest'
import {
  cosyvoiceWsUrl,
  isCosyvoiceVoiceId,
  resolveCosyvoiceModel,
  buildRunTaskMessage,
  buildContinueTaskMessage,
  buildFinishTaskMessage,
  wrapPcmAsWav,
} from './cosyvoiceSynth'

describe('cosyvoiceWsUrl（从 baseUrl 推导 CosyVoice 专用 WS 端点）', () => {
  it('MAAS 网关域名：去掉 compatible-mode/v1 路径，协议换 wss，拼 api-ws/v1/inference', () => {
    expect(cosyvoiceWsUrl('https://ws-jktdt1egszh0d8mm.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'))
      .toBe('wss://ws-jktdt1egszh0d8mm.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference')
  })

  it('裸域名同样生效', () => {
    expect(cosyvoiceWsUrl('https://dashscope.aliyuncs.com')).toBe('wss://dashscope.aliyuncs.com/api-ws/v1/inference')
  })

  it('非法 URL 兜底用默认 dashscope 域名', () => {
    expect(cosyvoiceWsUrl('not-a-url')).toBe('wss://dashscope.aliyuncs.com/api-ws/v1/inference')
  })
})

describe('isCosyvoiceVoiceId', () => {
  it('cosyvoice 前缀的 voiceId 判定为 true', () => {
    expect(isCosyvoiceVoiceId('cosyvoice-v2-vmrpxk11t-abbee20229224ef69b4792dd26bbf284')).toBe(true)
  })
  it('非 cosyvoice 前缀（如 qwen 预置音色名）判定为 false', () => {
    expect(isCosyvoiceVoiceId('Cherry')).toBe(false)
    expect(isCosyvoiceVoiceId(undefined)).toBe(false)
  })
})

describe('resolveCosyvoiceModel（从 voiceId 反推建声时的模型，须与合成模型一致）', () => {
  it('从 voiceId 前缀提取 cosyvoice-v2', () => {
    expect(resolveCosyvoiceModel('cosyvoice-v2-vmrpxk11t-abbee20229224ef69b4792dd26bbf284', 'qwen-tts')).toBe('cosyvoice-v2')
  })
  it('voiceId 取不到时，cfgModel 本身是 cosyvoice 系则用它', () => {
    expect(resolveCosyvoiceModel(undefined, 'cosyvoice-v1')).toBe('cosyvoice-v1')
  })
  it('两者都取不到时兜底 cosyvoice-v2', () => {
    expect(resolveCosyvoiceModel(undefined, 'qwen-tts')).toBe('cosyvoice-v2')
  })
})

describe('run-task/continue-task/finish-task 消息构造（字段核对自官方文档示例）', () => {
  const taskId = '2bf83b9a-baeb-4fda-8d9a-000000000000'

  it('run-task：header.action/task_id/streaming + payload.task_group=audio/task=tts/function=SpeechSynthesizer', () => {
    const msg = buildRunTaskMessage(taskId, 'cosyvoice-v2', 'cosyvoice-v2-vmrpxk11t-abbee2', { sampleRate: 22050 })
    expect(msg).toEqual({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model: 'cosyvoice-v2',
        parameters: {
          text_type: 'PlainText',
          voice: 'cosyvoice-v2-vmrpxk11t-abbee2',
          format: 'pcm',
          sample_rate: 22050,
          volume: 50,
          rate: 1.0,
          pitch: 1.0,
        },
        input: {},
      },
    })
  })

  it('continue-task：携带文本', () => {
    expect(buildContinueTaskMessage(taskId, '你好世界')).toEqual({
      header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
      payload: { input: { text: '你好世界' } },
    })
  })

  it('finish-task：空 input', () => {
    expect(buildFinishTaskMessage(taskId)).toEqual({
      header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
      payload: { input: {} },
    })
  })
})

describe('wrapPcmAsWav（把逐帧 PCM 拼成合法 WAV）', () => {
  it('生成的 header 尺寸字段与 RIFF/WAVE 魔数正确', () => {
    const pcm = Buffer.alloc(100, 1)
    const wav = wrapPcmAsWav(pcm, 22050)
    expect(wav.length).toBe(144)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt32LE(4)).toBe(36 + 100)
    expect(wav.readUInt32LE(24)).toBe(22050) // sample rate
    expect(wav.readUInt32LE(40)).toBe(100) // data size
  })
})
