export type LlmOpts = { system?: string; prompt: string; maxTokens?: number }
export type ImageOpts = { prompt: string; size?: string }
export type TtsOpts = { text: string; voice?: string }
export type AsrOpts = { audioPath: string }
export type AsrResult = { fullText: string; sentences: { text: string; startMs: number; endMs: number }[] }
