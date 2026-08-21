// 选书步骤的纯函数部分：稳定随机、角度池、书目解析、去重、本数解析。
// 全部无副作用（无 DB / 网络），禁止 Math.random()，同 seed 必得同结果。

export interface PickedBook { title: string; author: string; points?: string }

/** 文案切入角度池 */
export const ANGLES: string[] = ['金句式', '故事式', '痛点式', '对比式', '场景式']

/** 字符串 → 稳定非负整数，FNV-1a 32 位散列（无第三方依赖，纯函数）。
 *  早前用字符码累加（同 worker/templates/booklist/theme.ts 的 seedInt），
 *  但定长的生产种子（GenerationTask.id，36 位 uuid）累加后取值只落在约 1000 宽的窄带里，
 *  导致下游 LCG 的首个输出几乎是种子的线性函数，洗牌排列空间结构性塌缩（见分布回归测试）。
 *  FNV-1a 对输入的逐字符异或+质数乘法能把 36 字符差异打散到全 32 位值域。 */
export function seedFrom(seed: string): number {
  let hash = 0x811c9dc5 // FNV offset basis
  for (const c of String(seed ?? '')) {
    hash ^= c.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) // FNV prime
  }
  return hash >>> 0
}

/** 规范化书名：去掉书名号《》与首尾空白 */
function normalizeTitle(title: string): string {
  return String(title ?? '').replace(/[《》]/g, '').trim()
}

/** 线性同余生成器：以 seed 派生的整数为种子，逐步推进产出确定性伪随机序列（不得使用 Math.random） */
function makeLcg(seed: number): () => number {
  let state = (seed >>> 0) || 1
  const next = () => {
    // 数值取自 Numerical Recipes 的 LCG 参数，32 位溢出交给 >>> 0 处理
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296 // 归一化到 [0, 1)
  }
  // 预热：丢弃前两次输出。LCG 的首个输出是种子的近似线性像，即便种子已经过 FNV-1a 充分打散，
  // 直接用第一次输出去决定 Fisher-Yates 第一步的交换目标仍会让"元素 0 的落点"偏向种子的某些比特；
  // 多迭代几步能让状态充分混合，不再是种子的简单函数。
  next()
  next()
  return next
}

/** 从候选里按 seed 抽 n 本并打乱顺序；候选 <= n 时返回全部（仍按 seed 排序） */
export function pickSubset<T>(candidates: T[], n: number, seed: string): T[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return []
  const next = makeLcg(seedFrom(seed))
  // Fisher-Yates 全量洗牌，全靠 seed 派生的 LCG 驱动，与"起始偏移"式实现完全不同
  const shuffled = candidates.slice()
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const count = Math.max(0, Math.min(n, shuffled.length))
  return shuffled.slice(0, count)
}

/** 从 ANGLES 里按 seed 稳定挑一个切入角度 */
export function pickAngle(seed: string): string {
  return ANGLES[seedFrom(seed) % ANGLES.length]
}

/** 解析 LLM 返回的书目 JSON；容忍代码围栏；剔除缺书名/作者的条目 */
export function parseBookList(raw: string): PickedBook[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  // 剥掉 ```json ... ``` 或 ``` ... ``` 代码围栏
  const stripped = raw.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const result: PickedBook[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const title = typeof rec.title === 'string' ? normalizeTitle(rec.title) : ''
    const author = typeof rec.author === 'string' ? rec.author.trim() : ''
    if (!title || !author) continue
    const book: PickedBook = { title, author }
    if (typeof rec.points === 'string' && rec.points) book.points = rec.points
    result.push(book)
  }
  return result
}

// 副标题分隔符：全名版书名通常是「主标题<分隔符>副标题」。只有在分隔符处截断才算同一本，
// 否则「活着」会误吞「活着之上」。
const SUBTITLE_SEP = /^[：:—\-（(\s]/

/** 同一本书判定：规范化书名后一方是另一方的「副标题前缀」，且作者一致或一方为空 */
export function isSameBook(a: PickedBook, b: PickedBook): boolean {
  if (!a || !b || typeof a.title !== 'string' || typeof b.title !== 'string') return false
  const ta = normalizeTitle(a.title)
  const tb = normalizeTitle(b.title)
  if (!ta || !tb) return false
  const aa = typeof a.author === 'string' ? a.author.trim() : ''
  const ab = typeof b.author === 'string' ? b.author.trim() : ''
  // 作者都非空且不同 → 直接判为不同书（同名不同作者是不同版本/不同书）
  if (aa && ab && aa !== ab) return false
  if (ta === tb) return true
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (!long.startsWith(short)) return false
  return SUBTITLE_SEP.test(long.slice(short.length))
}

/** 候选的信息完整度：有作者优先于无作者；同为有/无作者时，有 points 优先 */
function completeness(b: PickedBook): number {
  let score = 0
  if ((b.author ?? '').trim()) score += 2
  if (b.points) score += 1
  return score
}

/** 合并候选并用 isSameBook 去重：命中时保留信息更全的一条，位置不变（先出现的位置） */
export function dedupeBooks(list: PickedBook[]): PickedBook[] {
  if (!Array.isArray(list)) return []
  const result: PickedBook[] = []
  for (const b of list) {
    if (!b || typeof b.title !== 'string' || typeof b.author !== 'string') continue
    const idx = result.findIndex((r) => isSameBook(r, b))
    if (idx === -1) {
      result.push(b)
      continue
    }
    if (completeness(b) > completeness(result[idx])) {
      result[idx] = b
    }
  }
  return result
}

/** 目标本数：__bookCount → books.length → 5，clamp 到 1..20 */
export function resolveBookCount(overlayTemplate: unknown): number {
  const clamp = (n: number) => Math.max(1, Math.min(20, n))
  if (overlayTemplate && typeof overlayTemplate === 'object') {
    const rec = overlayTemplate as Record<string, unknown>
    if (typeof rec.__bookCount === 'number' && Number.isFinite(rec.__bookCount)) {
      return clamp(Math.trunc(rec.__bookCount))
    }
    if (Array.isArray(rec.books)) {
      return clamp(rec.books.length)
    }
  }
  return 5
}

/**
 * 书名是否像中文读物。
 *
 * ── 为什么光改提示词不够 ──
 *
 * 选书的提示词早就要求「书名必须是中文」，但候选池是**先从书库召回、不足才联网**。
 * 那几本英文书（《Jane Eyre: New Casebooks》《The Brontë Myth》…）是在这条约束
 * 加上去**之前**沉淀进书库的，于是每次都被原样召回——提示词修好了，脏数据还在。
 *
 * 判据放在召回与写入两侧，脏数据既召不回来、也写不进去。
 *
 * 规则：含中日韩字符即通过；一个中文字都没有、却含拉丁字母的，判为外文原名。
 * 《1984》《S.》这类无字母的数字/符号书名放行——它们在中文市场就是这么叫的。
 */
export function looksChineseTitle(title: unknown): boolean {
  if (typeof title !== 'string') return false
  const t = title.replace(/[《》\s]/g, '')
  if (!t) return false
  if (/[一-鿿぀-ヿ가-힯]/.test(t)) return true
  return !/[A-Za-zÀ-ɏ]/.test(t)
}
