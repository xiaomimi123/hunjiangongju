// 重新入队某条任务的「合成」步骤，不重跑文案/选书/生图/配音。
//
// 用途：渲染器改动之后拿**同一份素材**重出成片，做 A/B 对照。
// 修渲染 bug 时这是最有价值的工具——重跑整条流水线不仅慢，而且文案与配图都会变，
// 根本没法判断「画面变好」是修复的功劳还是换了素材的偶然。
//
//   docker exec -w /app <worker容器> npx tsx worker/src/requeueRender.ts <genTaskId>
//   npm run requeue-render -w worker -- <genTaskId>

import { prisma, enqueueGen } from '@mixcut/db'

async function main(): Promise<void> {
  const genTaskId = process.argv[2]
  if (!genTaskId) {
    console.error('用法: requeueRender <genTaskId>')
    process.exit(2)
  }
  // 一条生成任务可能有多个渲染任务（改 BGM 会新建一条），取最新的那条
  const rt = await prisma.renderTask.findFirst({
    where: { generationTaskId: genTaskId },
    orderBy: { createdAt: 'desc' },
  })
  if (!rt) {
    console.error(`没有找到 generationTaskId=${genTaskId} 的 renderTask`)
    process.exit(1)
  }
  await enqueueGen('render-video', { renderTaskId: rt.id })
  console.log(`已重新入队 render-video: renderTaskId=${rt.id}`)
  console.log('产出会覆盖 data/gen/' + genTaskId + '/final.mp4')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
