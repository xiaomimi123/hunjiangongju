// 扣子工具箱后台校验：CozeTool.inputs 是 Json 字段，Prisma 不管形状，
// 脏值会一路传到运行时——尤其是 name，它被直接当扣子工作流的参数名用，
// 带空格/特殊字符会让运行莫名其妙地失败（且失败信息跟这里的校验完全对不上）。
import { HttpError } from './auth'

// fixed = 固定值：运营在后台填死一个值（如工作流要的第三方 api key），运行时服务端注入。
// 学员端列表接口会整项剥掉（值绝不能下发），学员提交的同名字段会被丢弃。
export const INPUT_TYPES = ['text', 'textarea', 'select', 'image', 'fixed'] as const
export type CozeInputType = (typeof INPUT_TYPES)[number]

const NAME_RE = /^[\w-]{1,64}$/

export type CozeToolInput = {
  name: string
  label: string
  type: CozeInputType
  options?: string[]
  placeholder?: string
  value?: string
  required: boolean
}

// 校验 inputs 数组，非法时抛 400 并指明第几项、错在哪（中文，运营自助排查）。
export function validateInputs(raw: unknown): CozeToolInput[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'inputs 必须是数组')
  // name 重名检查：学员端 validateInputsAgainst 按 name 逐项写结果对象，同名的两项会按声明顺序
  // 互相覆盖——例如先声明一个 image 字段又声明一个同名 text 字段，学员端校验实际只按最后一项
  // 的类型（text）走，image 该有的路径白名单校验就被绕过了，落到 worker 的字段就是任意字符串。
  const seenNames = new Map<string, number>() // name → 第一次出现的项序号（1-based）
  return raw.map((item, i) => {
    const at = `第 ${i + 1} 项`
    if (!item || typeof item !== 'object') throw new HttpError(400, `${at}：格式错误`)
    const o = item as Record<string, unknown>

    const name = typeof o.name === 'string' ? o.name : ''
    if (!NAME_RE.test(name)) {
      throw new HttpError(400, `${at}：name「${name}」不合法，只能是字母/数字/下划线/短横线，1-64 位`)
    }
    const firstSeenAt = seenNames.get(name)
    if (firstSeenAt !== undefined) {
      throw new HttpError(400, `第 ${i + 1} 项与第 ${firstSeenAt} 项参数名重复`)
    }
    seenNames.set(name, i + 1)

    const label = typeof o.label === 'string' ? o.label.trim() : ''
    if (!label) throw new HttpError(400, `${at}：label 不能为空`)

    const type = o.type
    if (typeof type !== 'string' || !(INPUT_TYPES as readonly string[]).includes(type)) {
      throw new HttpError(400, `${at}：type「${String(type)}」不合法，只能是 ${INPUT_TYPES.join('/')}`)
    }

    let options: string[] | undefined
    if (type === 'select') {
      const opts = o.options
      if (!Array.isArray(opts) || opts.length === 0 || opts.some((x) => typeof x !== 'string' || !x.trim())) {
        throw new HttpError(400, `${at}：type 为 select 时 options 必须是非空字符串数组`)
      }
      options = opts as string[]
    }

    let value: string | undefined
    if (type === 'fixed') {
      value = typeof o.value === 'string' ? o.value.trim() : ''
      if (!value) throw new HttpError(400, `${at}：type 为 fixed（固定值）时 value 不能为空`)
      if (value.length > 5000) throw new HttpError(400, `${at}：固定值不能超过 5000 字`)
    }

    // fixed 项的值由服务端注入，与学员是否必填无关，强制 false 免生歧义
    const required = type === 'fixed' ? false : o.required === true

    const placeholder = typeof o.placeholder === 'string' ? o.placeholder : undefined

    return {
      name,
      label,
      type: type as CozeInputType,
      ...(options ? { options } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(value !== undefined ? { value } : {}),
      required,
    }
  })
}

// priceCredits 夹到 [0, 1000] 的整数；非数字/非法输入一律拒收（不是静默夹到边界）。
export function validatePriceCredits(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new HttpError(400, 'priceCredits 必须是整数')
  }
  if (raw < 0 || raw > 1000) throw new HttpError(400, 'priceCredits 必须在 0-1000 之间')
  return raw
}

export function validateName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) throw new HttpError(400, 'name 不能为空')
  return name.slice(0, 40)
}

// 演示/教学视频 URL：本站上传路径或外链，空串/null 表示清除。防把任意脏字符串写进 <video src>。
export function validateVideoUrl(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') throw new HttpError(400, `${label}必须是字符串`)
  const url = raw.trim()
  if (!url) return null
  if (url.length > 500) throw new HttpError(400, `${label}过长`)
  if (!url.startsWith('/api/files/') && !/^https?:\/\//i.test(url)) {
    throw new HttpError(400, `${label}必须是本站上传路径（/api/files/…）或 http(s) 外链`)
  }
  return url
}

const WORKFLOW_ID_RE = /^[\w-]{1,128}$/

export function validateWorkflowId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : ''
  if (!WORKFLOW_ID_RE.test(id)) throw new HttpError(400, 'workflowId 不能为空，且只能是字母/数字/下划线/短横线，1-128 位')
  return id
}
