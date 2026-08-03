import { ttsSynthesize, isValidVoice, isPlausibleVoiceId } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'

// 固定试听示例句：治愈系人生感悟，供运营选定音色前快速听感确认
const SAMPLE = '今天分享的是活着，一段温柔而有力量的人生感悟。'

// 试听接口：运营鉴权 + 限流 + 白名单校验，合成固定示例句返回音频，不落库、不计入正式生成配额
export const POST = handler(async (req) => {
  const s = await requireRole('operator')
  checkRate('tts-preview', s.userId, 20)
  const { voice } = await req.json().catch(() => {
    throw new HttpError(400, '请求体格式错误')
  })
  if (!isValidVoice(voice) && !isPlausibleVoiceId(voice)) throw new HttpError(400, '未知音色')
  const audio = await ttsSynthesize({ text: SAMPLE, voice })
  return new Response(audio as unknown as BodyInit, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
  })
})
