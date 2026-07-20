import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@mixcut/db'
import { DATA_DIR } from './paths'

// 删除生成任务：级联删除分镜/渲染/质检（schema onDelete: Cascade）+ 清 /data/gen/<id> 素材成片。
export async function deleteGenerationTaskDeep(id: string): Promise<void> {
  await prisma.generationTask.delete({ where: { id } })
  await fs.rm(path.join(DATA_DIR, 'gen', id), { recursive: true, force: true }).catch(() => {})
}

// 删除框架：先删其下所有生成任务（外键 RESTRICT，须先删），再删框架。
export async function deleteFrameworkDeep(id: string): Promise<void> {
  const tasks = await prisma.generationTask.findMany({ where: { frameworkId: id }, select: { id: true } })
  for (const t of tasks) await deleteGenerationTaskDeep(t.id)
  await prisma.copyFramework.delete({ where: { id } })
}

// 删除拆解源视频：先删其派生的所有框架（连带各自的生成任务），再删源（转写/分镜切点 onDelete Cascade），
// 最后清理磁盘上以该 id 命名的源视频/音频/抽帧文件。
export async function deleteSourceVideoDeep(id: string): Promise<void> {
  const fws = await prisma.copyFramework.findMany({ where: { sourceVideoId: id }, select: { id: true } })
  for (const f of fws) await deleteFrameworkDeep(f.id)
  await prisma.sourceVideo.delete({ where: { id } })
  const dir = path.join(DATA_DIR, 'source')
  await fs
    .readdir(dir)
    .then((files) => Promise.all(files.filter((f) => f.includes(id)).map((f) => fs.rm(path.join(dir, f), { force: true }).catch(() => {}))))
    .catch(() => {})
}
