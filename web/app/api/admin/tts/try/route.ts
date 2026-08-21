// 试听一段配音。
//
// 为什么需要：新登记一个克隆音色后，「它到底能不能合成」现在只能靠跑一整条任务
// （文案 → 生图 → 配音）才知道。这个接口只做一次合成调用，几秒出声。
//
// 音色格式对 ≠ 音色可用：复刻任务没训练完、id 抄漏一位、resource 填错，
// 都会在真正合成时才暴露。

import { ttsSynthesize, isPlausibleVoiceId } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'
import { checkRate } from '@/lib/ratelimit'

/** 试听文本上限。试听是验音色可用性，不是拿来合成整段文案的 */
const MAX_CHARS = 60

export const POST = handler(async (req) => {
  const { userId } = await requireRole('operator')
  checkRate('tts-try', userId, 20)

  const body = (await req.json().catch(() => null)) as { text?: string; voice?: string } | null
  const text = (body?.text ?? '').trim()
  if (!text) throw new HttpError(400, '试听文本不能为空')
  if (Array.from(text).length > MAX_CHARS) throw new HttpError(400, `试听文本请控制在 ${MAX_CHARS} 字以内`)

  const voice = (body?.voice ?? '').trim()
  // 空音色 = 用配置里的默认音色；填了就必须是合法形状，防注入
  if (voice && !isPlausibleVoiceId(voice)) throw new HttpError(400, `音色 id 格式不合法：${voice}`)

  const t0 = Date.now()
  let audio: Buffer
  try {
    audio = await ttsSynthesize({ text, ...(voice ? { voice } : {}) })
  } catch (err) {
    // 把原文带出来：克隆音色最常见的失败是「音色不存在」与「resource 不对」，
    // 两者的处理方式完全不同（前者查 id，后者填 extra.cloneResourceId）
    throw new HttpError(502, `试听失败：${(err as Error).message?.slice(0, 400)}`)
  }

  return new Response(new Uint8Array(audio), {
    headers: {
      // 火山单向流式返回的是 mp3（volcanoTts.audio_params.format）；
      // mock 模式返回 wav。浏览器两种都认，统一按 mpeg 声明即可播放。
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-Gen-Ms': String(Date.now() - t0),
    },
  })
})
