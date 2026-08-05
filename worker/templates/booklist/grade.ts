// 剪映滤镜近似表 → CSS filter 函数链。静态字符串、无动画，seek-safe。
// 剪映滤镜是其自有查找表，拿不到；只对实测过的具名滤镜给近似配方，未知名只套对比度（见设计文档 §4）。
import type { GradeParams } from './templateParams.js'

interface Recipe { contrast: number; saturate: number; sepia: number; hueRotate: number }

// 满强度(intensity=1)配方；青橙=暖橙偏色+提饱和的电影感
const RECIPES: Record<string, Recipe> = {
  青橙: { contrast: 1.12, saturate: 1.25, sepia: 0.18, hueRotate: -10 },
}
const NEUTRAL: Recipe = { contrast: 1, saturate: 1, sepia: 0, hueRotate: 0 }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const r3 = (n: number) => Math.round(n * 1000) / 1000

export function gradeCss(grade: GradeParams | undefined): string {
  if (!grade) return ''
  const recipe = RECIPES[grade.filterName]
  const t = Math.max(0, Math.min(1, grade.intensity))
  const r: Recipe = recipe
    ? {
        contrast: lerp(NEUTRAL.contrast, recipe.contrast, t),
        saturate: lerp(NEUTRAL.saturate, recipe.saturate, t),
        sepia: lerp(NEUTRAL.sepia, recipe.sepia, t),
        hueRotate: lerp(NEUTRAL.hueRotate, recipe.hueRotate, t),
      }
    : { ...NEUTRAL }
  // 草稿自带的对比度调整（文档范围 -1..1，但来源不受控，越界值会让叠乘结果为负，
  // 而 CSS `filter` 里任何一个函数参数非法都会让整条声明失效，故这里防御性钳制）
  const contrastAdj = Math.max(-1, Math.min(1, grade.contrast))
  const contrast = r3(r.contrast * (1 + contrastAdj))
  const fns: string[] = []
  if (contrast !== 1) fns.push(`contrast(${contrast})`)
  if (r3(r.saturate) !== 1) fns.push(`saturate(${r3(r.saturate)})`)
  if (r3(r.sepia) !== 0) fns.push(`sepia(${r3(r.sepia)})`)
  if (r3(r.hueRotate) !== 0) fns.push(`hue-rotate(${r3(r.hueRotate)}deg)`)
  if (fns.length === 0) return ''
  // 同时作用于正片画面与快闪书封，保证全片同一调性
  return `    .scene .photo, .flashcard .fc-cover { filter: ${fns.join(' ')}; }`
}
