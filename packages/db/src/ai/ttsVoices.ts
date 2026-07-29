// 配音音色白名单（火山 Seed-TTS 2.0 候选；label 部署后试听锁定）。选择/试听都只认此表，防注入。
export interface TtsVoice { id: string; label: string }
export const TTS_VOICES: TtsVoice[] = [
  // 占位! 部署后按控制台已开通的实际 speaker 替换/增删
  { id: 'zh_female_wanwanxiaohe_moon_bigtts', label: '知性女声（待确认）' },
  { id: 'zh_male_M392_conversation_wvae_bigtts', label: '磁性男声（待确认）' },
]
export function isValidVoice(id: unknown): id is string {
  return typeof id === 'string' && TTS_VOICES.some((v) => v.id === id)
}
