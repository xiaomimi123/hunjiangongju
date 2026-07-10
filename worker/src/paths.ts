import path from 'path'

export const DATA_DIR = process.env.DATA_DIR ?? '/data'

export function urlToAbs(fileUrl: string): string {
  const rel = fileUrl.replace(/^\/api\/files\//, '')
  return path.join(DATA_DIR, rel)
}
