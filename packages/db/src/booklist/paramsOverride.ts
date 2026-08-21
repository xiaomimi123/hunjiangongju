// 逐任务的模板参数覆盖层。
//
// 背景：`__templateParams` 挂在 **框架**（CopyFramework.overlayTemplate）上，同一框架下
// 所有片子共用一份。运营想「就这一条改一下节奏/字幕/配乐」时无处下手——只能改框架，
// 而改框架会波及以后所有片子。
//
// 做法沿用系统里已有的唯一先例：BGM 的 `variables.__bgmId`
//（web/app/api/generate/[id]/bgm/route.ts）——不给 GenerationTask 加列，
// 参数塞进 `variables` 的保留键。渲染时把两份 raw JSON 深合并再交给 parseTemplateParams：
//
//     最终参数 = parseTemplateParams(mergeTemplateParamsRaw(框架的, 任务的))
//
// 三条性质：
// 1. 任务没有覆盖时，产出与合并前**完全一致**（老任务零回归）。
// 2. 覆盖是局部的：只写想改的字段，其余照框架。
// 3. 删掉覆盖即还原——不需要"记住原值再改回去"。

/** GenerationTask.variables 里存逐任务参数覆盖的保留键 */
export const TASK_PARAMS_KEY = '__templateParams'

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

/**
 * 深合并两份 **raw** 模板参数 JSON（合并发生在 parseTemplateParams **之前**）。
 *
 * - 对象递归合并；
 * - **数组整体替换，不逐元素合并**。像 `body.slotDurationsMs`、`transition.bodyCycle`、
 *   `motion.keyframes` 这些数组，元素之间是有序位关系的，逐元素合并会拼出一份
 *   「前几段用新的、后几段用旧的」的四不像；
 * - `override` 里的 `undefined` 视为「没写」，不会把 base 的值抹掉；
 *   要显式清空某字段，删掉整份覆盖或写入合法的新值。
 * - 任一侧不是对象（null / 数组 / 脏数据）时按空对象处理，绝不抛错——
 *   这份数据来自数据库 Json 列，脏了也不该让渲染整条挂掉。
 */
export function mergeTemplateParamsRaw(base: unknown, override: unknown): Record<string, unknown> {
  const b = isPlainObject(base) ? base : {}
  const o = isPlainObject(override) ? override : {}
  const out: Record<string, unknown> = { ...b }
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(b[k]) ? mergeTemplateParamsRaw(b[k], v) : v
  }
  return out
}

/** 从 GenerationTask.variables 里取出逐任务覆盖；没有/脏数据 → null */
export function readTaskParamsOverride(variables: unknown): Record<string, unknown> | null {
  if (!isPlainObject(variables)) return null
  const v = variables[TASK_PARAMS_KEY]
  return isPlainObject(v) ? v : null
}

/**
 * 渲染侧的统一入口：拿框架的 overlayTemplate 与任务的 variables，产出该交给
 * parseTemplateParams 的那份 raw JSON。
 *
 * ★ 所有读取模板参数的地方都必须走这里，否则会出现「画面按覆盖后的参数渲，
 * 混音却按框架原参数」这种半新半旧的成片。
 */
export function resolveTemplateParamsRaw(overlayTemplate: unknown, variables: unknown): unknown {
  const base = isPlainObject(overlayTemplate) ? overlayTemplate.__templateParams : undefined
  const override = readTaskParamsOverride(variables)
  // 没有覆盖时**原样返回 base**（不套一层 merge）：保证老任务这条路径逐字节不变
  if (!override) return base
  return mergeTemplateParamsRaw(base, override)
}
