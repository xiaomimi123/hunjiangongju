// 扣子(Coze) 工作流输出解析纯函数：把 cozeRunWorkflow 返回的 raw（未经解析，形状千差万别）
// 规整成前端可渲染的展示项列表。
//
// 纯函数边界很重要：不 import prisma、不碰 fs、不发网络。因此判断 URL 指向图片/视频/文件
// 只能靠路径后缀这种「看得出的静态信息」，不能靠 HTTP HEAD 探测 content-type ——
// 那是下游 worker 转存时才有条件做的事（Task 4 之后的任务），这里只管分类，不管下载。
//
// url 字段名是跨任务契约：worker 后续会对 image/video/file 项下载转存，原地改写同一个
// url 字段为本站路径；前端按 kind 渲染。改这个字段名等于同时破坏两端，不能改。

export type CozeOutputItem =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'video' | 'file'; url: string } // url 此时还是扣子远程 URL，转存是 worker 的事

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm'])

// 递归深度上限：防御恶意/意外的深嵌套输入把调用栈打爆或让解析耗时失控。
// 工作流输出实际结构一般不超过三四层，6 层留了充足冗余。超过就不再下钻，
// 该节点被当作「无法识别」直接跳过（不报错，只是漏掉这部分展示项）。
const MAX_DEPTH = 6

// text 项单条超过这个长度就截断，防止工作流返回超大文本把前端卡爆。
const TEXT_MAX_LEN = 5000

// 单条字符串值分类为 image/video/file/text 之一，或 null（数字/布尔早已在上层被过滤掉，不会走到这里）。
function classifyString(s: string): CozeOutputItem | null {
  if (/^https?:\/\//i.test(s)) {
    // 按 URL 的 pathname 后缀判断类型，query 不算——例如 `...png?sign=xxx` 仍按 .png 识别。
    // URL() 构造失败（极少见的畸形 URL）就退化为 file，不让整个解析炸掉。
    let pathname: string
    try {
      pathname = new URL(s).pathname
    } catch {
      return { kind: 'file', url: s }
    }
    const dot = pathname.lastIndexOf('.')
    const ext = dot >= 0 ? pathname.slice(dot).toLowerCase() : ''
    if (IMAGE_EXTS.has(ext)) return { kind: 'image', url: s }
    if (VIDEO_EXTS.has(ext)) return { kind: 'video', url: s }
    return { kind: 'file', url: s }
  }
  const trimmed = s.trim()
  if (trimmed.length < 2) return null // 太短的碎片（空格、单字符）不当有效文本
  const text = trimmed.length > TEXT_MAX_LEN ? `${trimmed.slice(0, TEXT_MAX_LEN)}…` : trimmed
  return { kind: 'text', text }
}

// 深度遍历任意 JSON 值，把途中遇到的字符串逐个分类并塞进 out（去重靠调用方维护的 seen 集合）。
// 数字/布尔/null/undefined 直接忽略——它们既不是 URL 也不是有意义的展示文本。
function walk(value: unknown, depth: number, out: CozeOutputItem[], seenUrls: Set<string>, seenTexts: Set<string>): void {
  if (depth > MAX_DEPTH) return
  if (typeof value === 'string') {
    const item = classifyString(value)
    if (!item) return
    if (item.kind === 'text') {
      if (seenTexts.has(item.text)) return
      seenTexts.add(item.text)
      out.push(item)
    } else {
      if (seenUrls.has(item.url)) return
      seenUrls.add(item.url)
      out.push(item)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, depth + 1, out, seenUrls, seenTexts)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) walk(v, depth + 1, out, seenUrls, seenTexts)
  }
  // number / boolean / null / undefined：忽略
}

export function parseCozeOutput(raw: unknown): CozeOutputItem[] {
  // raw 常见是扣子把工作流输出整个序列化成的 JSON 字符串，先 parse 一层。
  // 只 parse 这一层：parse 出来的结构内部如果某个字段又是 JSON 字符串，不再继续 parse——
  // 那是工作流自己业务数据里的字符串（例如一段看起来像 JSON 的文本内容），
  // 无限套娃解析既没有约定的终止条件，也可能被恶意构造成解析炸弹，所以就当普通字符串走分类。
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      // 不是合法 JSON。实测（2026-09-03 spike）扣子 run_histories 的 output 常因
      // 双重序列化转义 bug 而无法 parse——里面的产物 URL 不能因此丢掉。
      // 先用正则把 URL 捞出来逐个分类；有 URL 就只返回 URL 项（其余是节点状态等
      // 机器噪音，当 text 展示只会吓到学员），一个 URL 都没有才退回整串当文本。
      const urls = raw.match(/https?:\/\/[^\s"'\\<>]+/g)
      if (urls && urls.length > 0) {
        const out: CozeOutputItem[] = []
        const seen = new Set<string>()
        for (const uRaw of urls) {
          // 正则贪婪匹配容易把 URL 后面紧跟的中文/英文标点也吞进来（例如 "...mp4）" 或
          // "...png，"），裁掉尾部这类粘连标点，避免生成的链接打不开。
          const u = uRaw.replace(/[),.，。}\]]+$/, '')
          const item = classifyString(u)
          if (item && item.kind !== 'text' && !seen.has(item.url)) { seen.add(item.url); out.push(item) }
        }
        if (out.length > 0) return out
      }
      value = raw // 连 URL 都没有：当作原始字符串本身参与遍历分类
    }
  }

  const out: CozeOutputItem[] = []
  walk(value, 0, out, new Set<string>(), new Set<string>())
  return out
}
