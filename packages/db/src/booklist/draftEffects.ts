// 特效轨提取。`materials.video_effects` 与 `track.type==='effect'` 此前从未被任何代码读过
// （见 docs/BACKLOG.md P2 第 6 条），客户样例里的「水波纹」一直是未复刻状态。
//
// 实测语义（样例 今天分享的是/draft_content.json）：
//   materials.video_effects 只有 1 条：name='水波纹'，
//     adjust_params: effects_adjust_speed=0.33 / effects_adjust_distortion=1.0 / effects_adjust_volume=0.2
//   独立的 effect 轨上 1 段：3.991s → 4.448s（458ms）
//   同一时刻音频轨有「一滴水滴声」3.984s → 4.514s —— 水波纹是**给水滴音配的画面**，
//   位置正好压在快闪结束（3.984s）那一刀上。
//
// 因此这里除了绝对时间，还产出「相对快闪结束点的偏移」：我们的时间轴由 TTS 时长驱动，
// 绝对秒数照搬必然错位，但「跟着那一刀走」这个关系是稳定的。

export type EffectRenderType = 'ripple'

// 只收录样例出现过的「水波纹」。未命中的特效名一律返回 renderType=null，
// 由保真度报告如实告知运营「有特效但未复刻」，而不是静默套一个别的效果。
export const JIANYING_EFFECT_MAP: Record<string, EffectRenderType> = {
  水波纹: 'ripple',
}

export interface DraftEffect {
  sourceName: string
  /** null = 该特效名不在映射表中，未复刻 */
  renderType: EffectRenderType | null
  startMs: number
  durationMs: number
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
function usToMs(us: unknown): number {
  return typeof us === 'number' && Number.isFinite(us) ? Math.round(us / 1000) : 0
}

/**
 * 读出 effect 轨上的全部特效段，按时间升序。
 * 无 effect 轨、或段引用不到素材 → 空数组。
 */
export function extractDraftEffects(draft: unknown): DraftEffect[] {
  const d = obj(draft)
  const byId = new Map<string, Record<string, unknown>>()
  for (const raw of arr(obj(d.materials).video_effects)) {
    const v = obj(raw)
    const id = typeof v.id === 'string' ? v.id : ''
    if (id) byId.set(id, v)
  }
  if (byId.size === 0) return []

  const out: DraftEffect[] = []
  for (const rawTrack of arr(d.tracks)) {
    const t = obj(rawTrack)
    if (t.type !== 'effect') continue
    for (const rawSeg of arr(t.segments)) {
      const s = obj(rawSeg)
      const mat = byId.get(typeof s.material_id === 'string' ? s.material_id : '')
      if (!mat) continue
      const tr = obj(s.target_timerange)
      const durationMs = usToMs(tr.duration)
      if (durationMs <= 0) continue
      const sourceName = typeof mat.name === 'string' ? mat.name : ''
      out.push({
        sourceName,
        renderType: JIANYING_EFFECT_MAP[sourceName] ?? null,
        startMs: usToMs(tr.start),
        durationMs,
      })
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs)
}

export interface RippleParam {
  /** 相对「快闪结束」那一刀的偏移(ms)，可正可负 */
  offsetMs: number
  durationMs: number
}

/**
 * 取第一条可渲染的水波纹，换算成相对 `flashEndMs` 的偏移。
 *
 * 为什么用偏移而不是绝对时间：我们的分镜时长由 TTS 决定，与草稿不等长，
 * 照搬 3991ms 会落在完全不同的画面上。而「水波纹压在快闪→正片那一刀上」
 * 是创作者的意图，跟着刀口走才是复刻。
 *
 * 偏移绝对值超过 `maxOffsetMs`（默认 1.5s）视为与那一刀无关的独立特效，返回 null
 * ——硬按到刀口上会把它挪到创作者没打算放的位置，宁可不复刻并如实报告。
 */
export function deriveRipple(
  effects: DraftEffect[],
  flashEndMs: number,
  maxOffsetMs = 1500,
): RippleParam | null {
  if (!Number.isFinite(flashEndMs)) return null
  const hit = effects.find((e) => e.renderType === 'ripple')
  if (!hit) return null
  const offsetMs = hit.startMs - flashEndMs
  if (Math.abs(offsetMs) > maxOffsetMs) return null
  return { offsetMs, durationMs: hit.durationMs }
}
