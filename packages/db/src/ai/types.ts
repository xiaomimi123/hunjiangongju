export type LlmOpts = { system?: string; prompt: string; maxTokens?: number }
export type ImageOpts = { prompt: string; size?: string }
export type TtsOpts = { text: string; voice?: string; voiceId?: string }
export type AsrOpts = { audioUrl: string }
export type AsrResult = { fullText: string; sentences: { text: string; startMs: number; endMs: number }[] }
