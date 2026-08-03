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

// 形如合法音色 id（字母数字._- ，3~64 位）——用于放行内置白名单之外、但格式看起来合理的音色，
// 典型场景是火山「声音复刻2.0」克隆得到的 S_ 开头音色 ID，以及 DB 配置里运营自行登记的 customVoices。
export function isPlausibleVoiceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_.-]{3,64}$/.test(id)
}
