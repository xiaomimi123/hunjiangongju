// 框架允许学员使用的配音音色。
//
// 背景：非运营角色的 voice/voiceId 原先被**一律剥离**（stripVoiceForNonOperator），
// 理由是防止学员盗用运营的私有/付费克隆音色。但学员端的正常流程就是「填书名 + 选配音」，
// 一刀切剥离等于把这个流程堵死了。
//
// 折中：由**框架**声明哪些音色对学员开放。不同框架可以给不同音色，
// 克隆音色也能可控地放出去，而不是全开或全关。
//
// **校验必须在服务端做**：客户端传什么都不能信，只认框架里列出的那几个。

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}

export interface FrameworkVoices {
  /** 学员可选的音色 id。空数组表示不开放（维持"一律用默认音色"的老行为） */
  allowed: string[]
  /** 缺省选中的音色。必须在 allowed 里，否则忽略 */
  default?: string
}

export function readFrameworkVoices(overlayTemplate: unknown): FrameworkVoices {
  const raw = obj(obj(overlayTemplate).__voices)
  const allowed = (Array.isArray(raw.allowed) ? raw.allowed : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.trim())
  // 去重但保序：运营在后台勾选的顺序就是学员下拉里的顺序
  const uniq = Array.from(new Set(allowed))
  const def = typeof raw.default === 'string' ? raw.default.trim() : ''
  return {
    allowed: uniq,
    // default 不在 allowed 里就丢掉：否则学员会拿到一个自己选不了的音色，
    // 而且那正是「框架限制」想挡住的东西
    ...(def && uniq.includes(def) ? { default: def } : {}),
  }
}

/**
 * 学员提交的音色是否被这个框架允许。
 * @returns 允许则返回该音色；不允许（或没开放）返回 undefined —— 调用方据此剥离
 */
export function allowVoiceForFramework(overlayTemplate: unknown, voice: unknown): string | undefined {
  if (typeof voice !== 'string' || !voice.trim()) return undefined
  const { allowed } = readFrameworkVoices(overlayTemplate)
  return allowed.includes(voice.trim()) ? voice.trim() : undefined
}
