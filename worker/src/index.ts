import { startGenWorker } from './gen'

startGenWorker()

// 超时兜底后被抛弃的 job promise 若晚到 reject 不应拖垮整个 worker（保住并发中的其它任务）
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection (已容错，不退出):', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException (已容错，不退出):', err)
})
