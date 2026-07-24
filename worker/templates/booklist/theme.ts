// 设计 token 与 3 套风格预设。预设整套切换（只覆盖 token），结构 CSS 在 layout.ts 用 var() 引用。

export type PresetId = 'warm-literary' | 'dark-premium' | 'ink-oriental'
export const PRESET_IDS: PresetId[] = ['warm-literary', 'dark-premium', 'ink-oriental']

interface Tokens {
  bg: string
  ink: string
  inkDim: string
  accent: string
  scrim: string
  fsTitle: number
  fsBook: number
  fsCapZh: number
  fsCapEn: number
  fontTitle: string
  fontBody: string
  fontEn: string
  grain: boolean
}

const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const SERIF = '"Songti SC", "STSong", "SimSun", serif'
const SCRIPT = '"Bradley Hand", "Segoe Script", "Snell Roundhand", cursive'

const PRESETS: Record<PresetId, Tokens> = {
  'warm-literary': {
    bg: '#14100c', ink: '#ffffff', inkDim: '#f0e6d2', accent: '#f2b84b',
    scrim: 'rgba(0,0,0,0.72)', fsTitle: 46, fsBook: 46, fsCapZh: 36, fsCapEn: 22,
    fontTitle: SERIF, fontBody: SANS, fontEn: SCRIPT, grain: false,
  },
  'dark-premium': {
    bg: '#0b0b0d', ink: '#ffffff', inkDim: '#c9c9cf', accent: '#d4af6a',
    scrim: 'rgba(0,0,0,0.80)', fsTitle: 44, fsBook: 44, fsCapZh: 36, fsCapEn: 22,
    fontTitle: SANS, fontBody: SANS, fontEn: SCRIPT, grain: false,
  },
  'ink-oriental': {
    bg: '#12100e', ink: '#f6f1e6', inkDim: '#e8dfcf', accent: '#c1272d',
    scrim: 'rgba(0,0,0,0.70)', fsTitle: 48, fsBook: 48, fsCapZh: 36, fsCapEn: 22,
    fontTitle: SERIF, fontBody: SERIF, fontEn: SCRIPT, grain: true,
  },
}

/** 字符串 → 稳定非负整数（字符码累加），用于 seed 派生 */
export function seedInt(seed: string): number {
  let acc = 0
  for (const c of String(seed ?? '')) acc += c.charCodeAt(0)
  return acc
}

/** 选预设：style 精确命中优先，否则 seed 稳定派生 */
export function selectPreset(style: string | undefined, seed: string): PresetId {
  if (style && (PRESET_IDS as string[]).includes(style)) return style as PresetId
  return PRESET_IDS[seedInt(seed) % PRESET_IDS.length]
}

export function hasGrain(preset: PresetId): boolean {
  return PRESETS[preset].grain
}

/** 返回 :root 的 CSS 变量块 */
export function rootVarsCss(preset: PresetId): string {
  const t = PRESETS[preset]
  return `    :root {
      --bg: ${t.bg};
      --ink: ${t.ink};
      --ink-dim: ${t.inkDim};
      --accent: ${t.accent};
      --scrim: ${t.scrim};
      --fs-title: ${t.fsTitle}px;
      --fs-book: ${t.fsBook}px;
      --fs-cap-zh: ${t.fsCapZh}px;
      --fs-cap-en: ${t.fsCapEn}px;
      --font-title: ${t.fontTitle};
      --font-body: ${t.fontBody};
      --font-en: ${t.fontEn};
    }`
}
