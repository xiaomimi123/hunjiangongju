export * from './types'
export { getCapabilityConfig, isMockMode, CAPABILITIES } from './config'
export type { Capability, ResolvedCapConfig } from './config'
export { llmComplete } from './llm'
export { imageGenerate } from './image'
export { ttsSynthesize } from './tts'
export { asrTranscribe } from './asr'
import { llmComplete } from './llm'
import { imageGenerate } from './image'
import { ttsSynthesize } from './tts'
import type { Capability } from './config'

// 后台「测试连通」用：跑一次最小真实调用（mock 下必成功）
export async function testCapability(cap: Capability): Promise<{ ok: boolean; detail: string }> {
  try {
    if (cap === 'llm') { const t = await llmComplete({ prompt: '回复 ok' }); return { ok: true, detail: `LLM 返回 ${t.slice(0, 20)}…` } }
    if (cap === 'image') { const b = await imageGenerate({ prompt: 'test' }); return { ok: true, detail: `图片 ${b.length} 字节` } }
    if (cap === 'tts') { const b = await ttsSynthesize({ text: '测试' }); return { ok: true, detail: `音频 ${b.length} 字节` } }
    return { ok: true, detail: 'ASR 需上传音频，跳过在线测试（配置已保存）' }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}
