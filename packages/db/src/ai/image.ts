import { getCapabilityConfig, isMockMode } from './config'
import { mockImagePng } from './mock'
import { isDashScope, dashPost, fetchUrlToBuffer } from './dashscope'
import type { ImageOpts } from './types'

/**
 * 把调用方的 `720x960` 换成百炼要的 `W*H`，并放大到约 100 万像素、边长对齐 64。
 *
 * 为什么要放大：模型在过小的尺寸上细节会糊；1024 级别是这类模型的标定档位。
 * 为什么要对齐 64：扩散模型的潜空间按 8/64 分块，非整倍数的边长要么被拒、要么内部取整后变形。
 *
 * 之所以需要这个函数：DashScope 分支原先**完全忽略** opts.size，写死 `extra.size ?? '1024*1024'`
 * ——正方形出图再 cover 裁成 9:12，左右各砍掉 12.5%，人物特写的脸经常被裁到边上。
 * 那不是模型的问题，是我们自己把画面切了。
 */
export function toDashSize(size: string | undefined, fallback = '768*1024'): string {
  const m = /^(\d+)\s*[x*×]\s*(\d+)$/.exec((size ?? '').trim())
  if (!m) return fallback
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0 && h > 0)) return fallback
  // **比例优先**：在 64 的整数倍里挑一对最贴近原比例的边长，面积只作次要判据。
  // 第一版按面积缩放后各自对齐 64，720×960(3:4) 会变成 896×1152(0.778)——
  // 比例都没保住，等于白改：出图仍要被裁。
  const aspect = w / h
  let best = fallback
  let bestErr = Infinity
  for (let cw = 512; cw <= 1536; cw += 64) {
    const ch = Math.max(64, Math.round(cw / aspect / 64) * 64)
    const aspErr = Math.abs(cw / ch - aspect) / aspect
    const areaErr = Math.abs(cw * ch - 1_048_576) / 1_048_576
    // 比例误差权重远高于面积：1% 的比例偏差比 30% 的面积偏差更值得避免
    const err = aspErr * 100 + areaErr
    if (err < bestErr) { bestErr = err; best = `${cw}*${ch}` }
  }
  return best
}

/**
 * 临时覆盖生图配置。**只给后台的「试生成」用**——运营要在正式写进配置之前
 * 先比几个模型出图的效果，否则换模型只能靠猜名字 + 跑整条任务，试错太贵。
 *
 * credsFrom 让它复用**别的能力**的 base_url + 密钥：想在百炼标准平台上试 qwen-image，
 * 而现在 image 指向的是 MAAS 专属端点时，直接借 asr/vision 那把就行，不用重新填密钥。
 */
export interface ImageOverride {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export async function imageGenerate(opts: ImageOpts, override?: ImageOverride): Promise<Buffer> {
  const base = await getCapabilityConfig('image')
  const cfg = override
    ? {
        ...base,
        ...(override.baseUrl ? { baseUrl: override.baseUrl } : {}),
        ...(override.apiKey ? { apiKey: override.apiKey } : {}),
        ...(override.model ? { model: override.model } : {}),
        // 覆盖时忽略 image 能力自己的 extra.size：试生成要按传入的比例出图，
        // 否则会被线上那条固定档位盖掉，试了半天比例还是旧的
        extra: {},
        enabled: true,
      }
    : base
  if (isMockMode(cfg)) return mockImagePng()

  // 百炼 qwen-image：DashScope 原生 multimodal-generation，返回图片 URL
  if (isDashScope(cfg.baseUrl)) {
    // extra.size 优先（个别模型只接受固定档位，需要手工指定）；
    // 否则按调用方要的**比例**换算，不再写死正方形。
    const size = (cfg.extra.size as string) || toDashSize(opts.size)
    const data = await dashPost(cfg.baseUrl, cfg.apiKey, {
      model: cfg.model,
      input: { messages: [{ role: 'user', content: [{ text: opts.prompt }] }] },
      parameters: {
        size,
        watermark: false,
        prompt_extend: true,
        ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
      },
    })
    const content = (data.output as { choices?: { message?: { content?: { image?: string }[] } }[] })?.choices?.[0]?.message?.content
    const url = content?.find((c) => c.image)?.image
    if (typeof url !== 'string') throw new Error(`文生图返回格式异常: ${JSON.stringify(data).slice(0, 200)}`)
    return fetchUrlToBuffer(url)
  }

  // OpenAI 兼容默认
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, prompt: opts.prompt, size: opts.size ?? '1024x1792', response_format: 'b64_json' }),
  })
  if (!res.ok) throw new Error(`文生图请求失败 ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (typeof b64 !== 'string') throw new Error('文生图返回格式异常')
  return Buffer.from(b64, 'base64')
}
