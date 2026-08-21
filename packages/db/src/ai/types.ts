export type LlmOpts = {
  system?: string
  prompt: string
  maxTokens?: number
  temperature?: number
  enableSearch?: boolean
}
export type ImageOpts = {
  prompt: string
  size?: string
  negativePrompt?: string
  /**
   * 参考图的**公网可达** URL（百炼要自己去拉，本机路径不行）。
   * 给了它就是「参照这张图生成」——qwen-image-3.0 的 content 支持同时给 image 与 text。
   */
  refImageUrl?: string
}
export type TtsOpts = { text: string; voice?: string; voiceId?: string }
export type AsrOpts = { audioUrl: string }
export type AsrResult = { fullText: string; sentences: { text: string; startMs: number; endMs: number }[] }
