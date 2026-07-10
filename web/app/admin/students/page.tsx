'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'

type Row = { id: string; email: string; nickname: string | null; createdAt: string; taskCount: number; doneCount: number }
type Resp = { stats: { totalStudents: number; todayNew: number; totalTasks: number; totalExported: number }; students: Row[]; total: number }

const PAGE = 20

export default function StudentsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { setData(await api<Resp>(`/api/admin/students?search=${encodeURIComponent(search)}&page=${page}&pageSize=${PAGE}`)) }
    catch (e) { setErr((e as Error).message) }
  }, [search, page])
  useEffect(() => { load() }, [load])

  const stats = data?.stats
  const cards = [
    { k: '总学员数', v: stats?.totalStudents }, { k: '今日新增', v: stats?.todayNew },
    { k: '总任务数', v: stats?.totalTasks }, { k: '导出成片', v: stats?.totalExported },
  ]
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">注册学员数据</h1>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.k} className="card p-5">
            <p className="text-sm text-ink3">{c.k}</p>
            <p className="num mt-1 text-3xl font-bold">{c.v ?? '—'}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <input className="field max-w-xs" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value) }} placeholder="搜索邮箱 / 昵称" autoCapitalize="none" />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">邮箱</th>
              <th className="px-4 py-3 font-medium">昵称</th>
              <th className="px-4 py-3 font-medium">注册时间</th>
              <th className="px-4 py-3 text-right font-medium">任务数</th>
              <th className="px-4 py-3 text-right font-medium">已完成</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.students.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">{s.email}</td>
                <td className="px-4 py-3">{s.nickname ?? '—'}</td>
                <td className="num px-4 py-3 text-ink2">{new Date(s.createdAt).toLocaleString('zh-CN')}</td>
                <td className="num px-4 py-3 text-right">{s.taskCount}</td>
                <td className="num px-4 py-3 text-right text-ok">{s.doneCount}</td>
              </tr>
            ))}
            {data && data.students.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink3">暂无学员</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost px-4">上一页</button>
          <span className="num text-sm text-ink2">{page} / {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="btn-ghost px-4">下一页</button>
        </div>
      )}
    </div>
  )
}
