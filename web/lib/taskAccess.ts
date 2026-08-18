/**
 * 生成任务的访问归属校验。
 *
 * 这条规则原本以复制粘贴的形式散落在 web/app/api/generate/[id]/** 的 10 个接口里，副本之间
 * 已经开始漂移：详情接口写的是 `task.createdBy && task.createdBy !== userId`（createdBy 为空
 * 视为谁都能看），其余写的是 `task.createdBy !== userId`（为空则谁都看不了）。同一条规则两种
 * 行为。抽到这里统一，新增接口一律复用，不要再手写。
 *
 * 规则：
 * - 运营（operator）可访问任意任务。后台「生成栏」现在会列出学员创建的任务，若详情/操作类
 *   接口仍只认创建人，运营点进去必然 404——列表看得见、点不开。
 * - 其他角色只能访问自己创建的任务；`createdBy` 为空（字段引入前的历史任务）**一律拒绝**，
 *   因为无法证明归属。这比旧详情接口"为空即公开"更严，且与列表行为一致：列表按
 *   `createdBy: userId` 过滤，空值本就不会出现在任何学员的列表里。
 */
// 写成类型守卫（而非返回 boolean）：调用点原本是 `if (!task || task.createdBy !== ...)`，
// 里面的 `!task` 让 TS 把后续代码里的 task 收窄成非空。抽成普通函数会丢掉这个收窄，
// 各调用点全部报 "'task' is possibly 'null'"。用 `task is T` 把收窄能力还回去。
export function canAccessTask<T extends { createdBy: string | null }>(
  task: T | null | undefined,
  session: { userId: string; role: string },
): task is T {
  if (!task) return false
  if (session.role === 'operator') return true
  return !!task.createdBy && task.createdBy === session.userId
}
