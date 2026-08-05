// 从 materials.effects 提取调色配方：滤镜名+强度、对比度、锐化。
// 剪映滤镜是其自有查找表，拿不到；此处只如实记录名字与数值，近似渲染由 worker 侧的具名表决定。
import type { GradeParams } from './templateParams'

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}
const r4 = (n: number) => Math.round(n * 10000) / 10000

export function extractDraftGrade(draft: unknown): GradeParams | null {
  const effects = arr(obj(obj(draft).materials).effects).map(obj)
  if (effects.length === 0) return null
  let filterName = ''
  let intensity = 0
  let contrast = 0
  let sharpen = false
  for (const e of effects) {
    const type = typeof e.type === 'string' ? e.type : ''
    const value = typeof e.value === 'number' && Number.isFinite(e.value) ? e.value : 0
    if (type === 'filter') {
      const name = typeof e.name === 'string' ? e.name.trim() : ''
      if (name && !filterName) { filterName = name; intensity = r4(value) }
    } else if (type === 'contrast') {
      contrast = r4(value)
    } else if (type === 'sharpen') {
      sharpen = true
    }
  }
  if (!filterName && contrast === 0 && !sharpen) return null
  return { filterName, intensity, contrast, sharpen }
}
