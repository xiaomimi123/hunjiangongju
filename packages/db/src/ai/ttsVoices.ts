// 配音音色白名单（qwen-tts 候选；label 部署后试听锁定）。选择/试听都只认此表，防注入。
export interface TtsVoice { id: string; label: string }
export const TTS_VOICES: TtsVoice[] = [
  { id: 'Cherry', label: '知性女声（Cherry）' },
  { id: 'Serena', label: '温柔女声（Serena）' },
  { id: 'Ethan', label: '磁性男声（Ethan）' },
  { id: 'Chelsie', label: '清亮女声（Chelsie）' },
]
export function isValidVoice(id: unknown): id is string {
  return typeof id === 'string' && TTS_VOICES.some((v) => v.id === id)
}
