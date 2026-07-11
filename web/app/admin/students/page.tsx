'use client'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import { StatusPill } from '@/components/ui'

type Row = { id: string; email: string; nickname: string | null; disabled: boolean; createdAt: string; taskCount: number; doneCount: number }
type Resp = { stats: { totalStudents: number; todayNew: number; totalTasks: number; totalExported: number }; students: Row[]; total: number }
type Task = { id: string; status: string; aspectRatio: string; createdAt: string; script: { title: string } | null }

const PAGE = 20

export default function StudentsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState('')

  const [expanded, setExpanded] = useState('')          // 展开查看作品的学员 id
  const [works, setWorks] = useState<Task[] | null>(null)
  const [resetFor, setResetFor] = useState<Row | null>(null) // 重置密码弹窗目标
  const [newPw, setNewPw] = useState('')
  const [modalErr, setModalErr] = useState('')
  const [modalMsg, setModalMsg] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    try { setData(await api<Resp>(`/api/admin/students?search=${encodeURIComponent(debounced)}&page=${page}&pageSize=${PAGE}`)) }
    catch (e) { setErr((e as Error).message) }
  }, [debounced, page])
  useEffect(() => { load() }, [load])

  async function toggleWorks(id: string) {
    if (expanded === id) { setExpanded(''); setWorks(null); return }
    setExpanded(id); setWorks(null)
    try { const r = await api<{ tasks: Task[] }>(`/api/admin/students/${id}`); setWorks(r.tasks) }
    catch (e) { setErr((e as Error).message) }
  }

  async function setDisabled(s: Row, disabled: boolean) {
    setBusyId(s.id); setErr('')
    try { await api(`/api/admin/students/${s.id}`, { method: 'PATCH', body: { action: disabled ? 'disable' : 'enable' } }); await load() }
    catch (e) { setErr((e as Error).message) } finally { setBusyId('') }
  }

  async function remove(s: Row) {
    if (!confirm(`确定删除学员「${s.nickname ?? s.email}」及其全部任务数据？此操作不可恢复。`)) return
    setBusyId(s.id); setErr('')
    try { await api(`/api/admin/students/${s.id}`, { method: 'DELETE' }); if (expanded === s.id) setExpanded(''); await load() }
    catch (e) { setErr((e as Error).message) } finally { setBusyId('') }
  }

  async function doReset() {
    if (!resetFor) return
    setModalErr(''); setModalMsg('')
    setBusyId(resetFor.id)
    try {
      await api(`/api/admin/students/${resetFor.id}`, { method: 'PATCH', body: { action: 'reset', password: newPw } })
      setModalMsg('密码已重置'); setTimeout(() => { setResetFor(null); setNewPw('') }, 900)
    } catch (e) { setModalErr((e as Error).message) } finally { setBusyId('') }
  }

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

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">邮箱</th>
              <th className="px-4 py-3 font-medium">昵称</th>
              <th className="px-4 py-3 font-medium">注册时间</th>
              <th className="px-4 py-3 text-right font-medium">任务</th>
              <th className="px-4 py-3 text-right font-medium">已完成</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.students.map((s) => (
              <Fragment key={s.id}>
                <tr className={s.disabled ? 'opacity-55' : ''}>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      {s.email}
                      {s.disabled && <span className="pill pill-bad">已禁用</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3">{s.nickname ?? '—'}</td>
                  <td className="num px-4 py-3 text-ink2">{new Date(s.createdAt).toLocaleString('zh-CN')}</td>
                  <td className="num px-4 py-3 text-right">{s.taskCount}</td>
                  <td className="num px-4 py-3 text-right text-ok">{s.doneCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3 whitespace-nowrap text-sm">
                      <button onClick={() => toggleWorks(s.id)} className="text-flame">{expanded === s.id ? '收起' : '作品'}</button>
                      <button onClick={() => { setResetFor(s); setNewPw(''); setModalErr(''); setModalMsg('') }} className="text-ink2 hover:text-ink">重置密码</button>
                      <button onClick={() => setDisabled(s, !s.disabled)} disabled={busyId === s.id} className="text-ink2 hover:text-ink disabled:text-ink3">{s.disabled ? '启用' : '禁用'}</button>
                      <button onClick={() => remove(s)} disabled={busyId === s.id} className="text-bad disabled:text-ink3">删除</button>
                    </div>
                  </td>
                </tr>
                {expanded === s.id && (
                  <tr>
                    <td colSpan={6} className="bg-surface2 px-4 py-3">
                      {works === null ? <p className="text-ink3">加载中…</p>
                        : works.length === 0 ? <p className="text-ink3">该学员暂无作品</p>
                        : (
                          <ul className="space-y-1.5">
                            {works.map((t) => (
                              <li key={t.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                                <span className="min-w-0 truncate">{t.script?.title ?? '未知文案'} <span className="num text-xs text-ink3">{t.aspectRatio}</span></span>
                                <span className="flex items-center gap-3">
                                  <span className="num text-xs text-ink3">{new Date(t.createdAt).toLocaleString('zh-CN')}</span>
                                  <StatusPill status={t.status} />
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data && data.students.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink3">暂无学员</td></tr>
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

      {resetFor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => { if (busyId !== resetFor.id) setResetFor(null) }}>
          <div className="card w-full max-w-sm space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-bold">重置密码</h3>
              <p className="mt-1 text-sm text-ink3">为「{resetFor.nickname ?? resetFor.email}」设置新登录密码</p>
            </div>
            <input className="field" type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="新密码（至少 8 位）" autoFocus />
            {modalErr && <p className="pill pill-bad">{modalErr}</p>}
            {modalMsg && <p className="pill pill-ok">{modalMsg}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setResetFor(null)} className="btn-ghost px-4">取消</button>
              <button onClick={doReset} disabled={busyId === resetFor.id} className="btn-primary px-5">{busyId === resetFor.id ? '处理中…' : '确认重置'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
