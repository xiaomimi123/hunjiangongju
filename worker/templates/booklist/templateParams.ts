// 契约已移至 @mixcut/db（web 上传接口与 worker 渲染共享同一份）。此处 re-export 保持 worker 内既有 import 路径不变。
export { DEFAULT_PARAMS, parseTemplateParams, flashTimeline } from '@mixcut/db'
export type { TemplateParams, TemplateMode, FlashTimeline, GradeParams } from '@mixcut/db'
