export * from './types'
export { getCapabilityConfig, isMockMode, CAPABILITIES } from './config'
export type { Capability, ResolvedCapConfig } from './config'
export { llmComplete } from './llm'
export { imageGenerate, toDashSize, imageKeyPool, imageConcurrency } from './image'
export { dashListModels, dashCompatBase } from './dashscope'
export type { ImageOverride } from './image'
export { ttsSynthesize } from './tts'
export { cosyvoiceSynthesize, cosyvoiceWsUrl, isCosyvoiceVoiceId, resolveCosyvoiceModel } from './cosyvoiceSynth'
export type { CosyvoiceSynthOpts } from './cosyvoiceSynth'
export { asrTranscribe } from './asr'
export { enrollVoice, parseEnrollResult, listVoices } from './voiceClone'
export { describeImageStyle, parseVisionStyle, MOCK_VISION_STYLE, describeBooksFromImages, parseBooksResult, describeStyleForPrompt, parseStylePrompt, MOCK_STYLE_PROMPT } from './vision'
export type { VisualStyleType, VisionStyleResult } from './vision'
export { TTS_VOICES, isValidVoice, isPlausibleVoiceId } from './ttsVoices'
export type { TtsVoice } from './ttsVoices'
export { isVolcano, buildVolcanoBody, buildVolcanoHeaders, parseVolcanoStream, volcanoTtsSynthesize } from './volcanoTts'
export { cozeRunWorkflow, cozeUploadFile, cozeFetchWorkflowParams } from './coze'
export type { CozeFetch } from './coze'
export { parseCozeOutput } from './cozeOutput'
export type { CozeOutputItem } from './cozeOutput'
export { cozeProbeWorkflowParams } from './cozeProbe'
export type { CozeProbedField, CozeProbeResult } from './cozeProbe'
export { photoGenerate, isMockPhotoUrl, mockPhotoBytes, parsePhotoTask, queryPhotoBalance, parsePhotoBalance } from './photoGen'
export type { PhotoBalance } from './photoGen'
export type { PhotoGenOpts } from './photoGen'
export {
  buildCoverPrompt, buildInnerPrompt,
  COVER_SHOT_MODES, COVER_SHOT_LABELS, INNER_STYLES, INNER_STYLE_LABELS,
} from './photoPromptData'
export type { CoverShotMode, InnerStyle, InnerPageSide, InnerTitleBand } from './photoPromptData'
export { classifyInnerPage, parseInnerPage, MOCK_INNER_PAGE } from './vision'
export type { InnerPageInfo } from './vision'
import { llmComplete } from './llm'
import { imageGenerate } from './image'
import { ttsSynthesize } from './tts'
import { getCapabilityConfig } from './config'
import type { Capability } from './config'

// 后台「测试连通」用：跑一次最小真实调用（mock 下必成功）
export async function testCapability(cap: Capability): Promise<{ ok: boolean; detail: string }> {
  try {
    if (cap === 'llm') { const t = await llmComplete({ prompt: '回复 ok' }); return { ok: true, detail: `LLM 返回 ${t.slice(0, 20)}…` } }
    if (cap === 'image') { const b = await imageGenerate({ prompt: 'test' }); return { ok: true, detail: `图片 ${b.length} 字节` } }
    if (cap === 'tts') { const b = await ttsSynthesize({ text: '测试' }); return { ok: true, detail: `音频 ${b.length} 字节` } }
    if (cap === 'vision') return { ok: true, detail: '画风识别需图片输入，跳过在线测试（配置已保存）' }
    if (cap === 'coze') {
      // 扣子没有一个不依赖真实 workflowId 的轻量连通性探针，跑「最小真实调用」在这里不现实。
      // 诚实优于假绿：只校验配置存在，不假装验证了 Token 是否真的可用——
      // 之前落到 ASR 的兜底分支会显示「跳过在线测试」这种驴唇不对马嘴的文案。
      const cfg = await getCapabilityConfig('coze')
      if (!cfg.apiKey) return { ok: false, detail: '未配置 Token' }
      return { ok: true, detail: '已保存。扣子连通性将在首次拉取参数或运行时验证' }
    }
    if (cap === 'photo') {
      // 实拍生图的最小真实调用要花一次真实生图费且耗时约 1 分钟——只校验配置，
      // 与 coze 同理：诚实优于假绿。
      const cfg = await getCapabilityConfig('photo')
      if (!cfg.baseUrl) return { ok: false, detail: '未配置接口地址' }
      if (!cfg.apiKey) return { ok: false, detail: '未配置密钥' }
      return { ok: true, detail: '已保存。生图连通性将在学员首次运行时验证（每次生成为真实计费调用）' }
    }
    return { ok: true, detail: 'ASR 需上传音频，跳过在线测试（配置已保存）' }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}
