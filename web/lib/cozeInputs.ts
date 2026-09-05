// 学员运行扣子工具时，按工具在后台声明的 inputs 逐项校验提交的值。
// 后台的 cozeToolAdmin.validateInputs 只保证「工具定义」本身合法（name/type/options 等），
// 这里校验的是「学员这一次提交的值」是否满足该定义——必填、select 落在 options 内、
// image 是本站 coze-uploads/ 下的合法相对路径（防路径穿越：../../etc/passwd 之类必须拒）。
import { HttpError } from './auth'
import type { CozeToolInput } from './cozeToolAdmin'

// UUID（randomUUID() 落盘时用的格式）+ 白名单扩展名，与 upload 路由写盘时的命名规则一致。
const IMAGE_REL_RE = /^coze-uploads\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/

const MAX_TEXT_LEN = 5000

export function validateInputsAgainst(toolInputs: unknown, submitted: unknown): Record<string, unknown> {
  const declared = Array.isArray(toolInputs) ? (toolInputs as CozeToolInput[]) : []
  const sub = submitted && typeof submitted === 'object' ? (submitted as Record<string, unknown>) : {}
  const result: Record<string, unknown> = {}

  for (const item of declared) {
    // fixed（固定值）项：值由运营配死、worker 运行时注入。学员端看不到这个字段，
    // 学员就算手动构造同名字段提交也直接丢弃——绝不写进 run.inputs（运行记录列表
    // 接口会下发 inputs，写进去就把固定值泄露给本人了）。
    if (item.type === 'fixed') continue
    const raw = sub[item.name]
    const empty = raw === undefined || raw === null || raw === ''
    if (item.required && empty) {
      throw new HttpError(400, `「${item.label}」不能为空`)
    }
    // 非必填且未填：不写入结果，交给下游（扣子工作流）走它自己的默认值
    if (empty) continue

    if (item.type === 'select') {
      if (typeof raw !== 'string' || !(item.options ?? []).includes(raw)) {
        throw new HttpError(400, `「${item.label}」的值不在可选项内`)
      }
      result[item.name] = raw
    } else if (item.type === 'image') {
      if (typeof raw !== 'string' || !IMAGE_REL_RE.test(raw)) {
        throw new HttpError(400, `「${item.label}」不是合法的图片路径`)
      }
      result[item.name] = raw
    } else {
      // text / textarea：非字符串（数字/布尔）转字符串；对象/数组这类明显错误的形状直接 400——
      // 早先把它们静默转成 ''，会绕过上面的 required 判定（{} 不是 undefined/null/''，
      // 但转完是空串）：required 字段传个空对象就能骗过校验，白扣分建 run 让 worker 拿空串跑。
      if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
        throw new HttpError(400, `「${item.label}」必须是文本`)
      }
      const str = typeof raw === 'string' ? raw : String(raw)
      if (item.required && str === '') {
        throw new HttpError(400, `「${item.label}」不能为空`)
      }
      result[item.name] = str.slice(0, MAX_TEXT_LEN)
    }
  }
  // declared 里没有的字段（学员多传的杂项）直接丢弃，不报错——未声明的多余字段不该让整次提交失败

  return result
}
