// 配音音色白名单（火山「豆包语音合成大模型2.0」uranus_bigtts 音色）。选择/试听都只认此表，防注入。
// 均为 seed-tts-2.0 音色、支持语音指令(情绪)；如需增删见 控制台>音色库 或 音色列表文档。
export interface TtsVoice { id: string; label: string }
export const TTS_VOICES: TtsVoice[] = [
  { id: 'zh_female_vv_uranus_bigtts', label: '知性女声 Vivi' },        // 已验证可用
  { id: 'zh_female_zhixingnv_uranus_bigtts', label: '知性女声' },
  { id: 'zh_female_wenrouxiaoya_uranus_bigtts', label: '温柔女声（治愈）' },
  { id: 'zh_female_xinlingjitang_uranus_bigtts', label: '心灵鸡汤女声' },
  { id: 'zh_male_ruyayichen_uranus_bigtts', label: '儒雅男声' },
  { id: 'zh_male_baqiqingshu_uranus_bigtts', label: '磁性青叔（有声阅读）' },
  { id: 'zh_male_cixingjieshuonan_uranus_bigtts', label: '磁性解说男声' },
]
export function isValidVoice(id: unknown): id is string {
  return typeof id === 'string' && TTS_VOICES.some((v) => v.id === id)
}
