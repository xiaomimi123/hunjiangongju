'use client'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/fetcher'
import { StatusPill } from '@/components/ui'
import PageHeader from '@/components/admin/PageHeader'

type Row = { id: string; email: string; nickname: string | null; disabled: boolean; createdAt: string; taskCount: number; doneCount: number; genLimit: number | null; genUsed: number }
type Resp = { stats: { totalStudents: number; todayNew: number; totalTasks: number; totalExported: number }; students: Row[]; total: number }
type Task = { id: string; status: string; subject: string; createdAt: string; framework: { name: string | null } | null }
// 重置密码弹窗共用（学员/运营账号字段一致，仅需 id/email/nickname）
type AccountRef = { id: string; email: string; nickname: string | null }
type OpRow = { id: string; email: string; nickname: string | null; disabled: boolean; createdAt: string }

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
  const [resetFor, setResetFor] = useState<AccountRef | null>(null) // 重置密码弹窗目标（学员/运营共用）
  const [newPw, setNewPw] = useState('')
  const [modalErr, setModalErr] = useState('')
  const [modalMsg, setModalMsg] = useState('')

  // 新增账号弹层
  const [showAdd, setShowAdd] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newNickname, setNewNickname] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'student' | 'operator'>('student')
  const [addErr, setAddErr] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  // 运营账号小节
  const [opOpen, setOpOpen] = useState(false)
  const [operators, setOperators] = useState<OpRow[] | null>(null)
  const [opErr, setOpErr] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    try { setData(await api<Resp>(`/api/admin/students?search=${encodeURIComponent(debounced)}&page=${page}&pageSize=${PAGE}`)) }
    catch (e) { setErr((e as Error).message) }
  }, [debounced, page])
  useEffect(() => { load() }, [load])

  const loadOperators = useCallback(async () => {
    try { setOperators((await api<Resp>('/api/admin/students?role=operator&pageSize=50')).students) }
    catch (e) { setOpErr((e as Error).message) }
  }, [])
  useEffect(() => { if (opOpen) loadOperators() }, [opOpen, loadOperators])

  async function toggleWorks(id: string) {
    if (expanded === id) { setExpanded(''); setWorks(null); return }
    setExpanded(id); setWorks(null)
    try { const r = await api<{ tasks: Task[] }>(`/api/admin/students/${id}`); setWorks(r.tasks) }
    catch (e) { setErr((e as Error).message) }
  }

  async function setDisabled(s: AccountRef, disabled: boolean, kind: 'student' | 'operator' = 'student') {
    setBusyId(s.id); setErr(''); setOpErr('')
    try {
      await api(`/api/admin/students/${s.id}`, { method: 'PATCH', body: { action: disabled ? 'disable' : 'enable' } })
      if (kind === 'operator') await loadOperators(); else await load()
    }
    catch (e) { (kind === 'operator' ? setOpErr : setErr)((e as Error).message) } finally { setBusyId('') }
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

  async function createAccount() {
    setAddErr('')
    if (!newEmail.trim()) { setAddErr(newRole === 'student' ? '请填写 11 位手机号' : '请填写手机号或邮箱'); return }
    if (newRole === 'student' && !/^\d{11}$/.test(newEmail.trim())) { setAddErr('学员账号须为 11 位手机号'); return }
    setAddBusy(true)
    try {
      await api('/api/admin/students', { body: { email: newEmail.trim(), nickname: newNickname.trim(), password: newPassword, role: newRole } })
      setShowAdd(false); setNewEmail(''); setNewNickname(''); setNewPassword(''); setNewRole('student')
      if (newRole === 'operator') { setOpOpen(true); await loadOperators() } else { await load() }
    } catch (e) { setAddErr((e as Error).message) } finally { setAddBusy(false) }
  }

  const stats = data?.stats
  const cards = [
    { k: '总学员数', v: stats?.totalStudents }, { k: '今日新增', v: stats?.todayNew },
    { k: '总任务数', v: stats?.totalTasks }, { k: '导出成片', v: stats?.totalExported },
  ]
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1

  return (
    <div className="space-y-5">
      <PageHeader title="学员数据" subtitle="注册学员的作品与账号管理">
        <button onClick={() => { setShowAdd(true); setAddErr(''); setNewRole('student') }} className="btn-primary px-4">＋ 新增账号</button>
      </PageHeader>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.k} className="card p-5">
            <p className="text-sm text-ink3">{c.k}</p>
            <p className="num mt-1 text-3xl font-bold">{c.v ?? '—'}</p>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <button onClick={() => setOpOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="font-semibold">运营账号{operators ? `（${operators.length}）` : ''}</span>
          <span className="text-ink3">{opOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {opOpen && (
          <div className="mt-4 space-y-2.5">
            {opErr && <p className="pill pill-bad">{opErr}</p>}
            {operators === null ? <p className="text-sm text-ink3">加载中…</p>
              : operators.length === 0 ? <p className="text-sm text-ink3">暂无运营账号</p>
              : operators.map((o) => (
                <div key={o.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface2 px-3 py-2.5 ${o.disabled ? 'opacity-55' : ''}`}>
                  <span className="inline-flex items-center gap-2 text-sm">
                    {o.email} <span className="text-ink3">{o.nickname ?? ''}</span>
                    {o.disabled && <span className="pill pill-bad">已禁用</span>}
                  </span>
                  <div className="flex items-center gap-3 text-sm">
                    <button onClick={() => { setResetFor(o); setNewPw(''); setModalErr(''); setModalMsg('') }} className="text-ink2 hover:text-ink">重置密码</button>
                    <button onClick={() => setDisabled(o, !o.disabled, 'operator')} disabled={busyId === o.id} className="text-ink2 hover:text-ink disabled:text-ink3">{o.disabled ? '启用' : '禁用'}</button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input className="field max-w-xs" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value) }} placeholder="搜索手机号 / 昵称" autoCapitalize="none" />
        <button
          className="btn-ghost text-xs"
          onClick={async () => {
            const v = prompt('给全部学员统一设置生成额度（条数）。填 0 = 全部禁止生成；留空/取消 = 不改；填 -1 = 全部改为不限')
            if (v === null || v.trim() === '') return
            const n = Number(v.trim())
            if (!Number.isInteger(n) || n < -1) { alert('请输入 -1、0 或正整数'); return }
            try {
              const r = await api<{ updated: number }>('/api/admin/students/gen-limit', { method: 'POST', body: { limit: n === -1 ? null : n } })
              alert(`已更新 ${r.updated} 名学员的额度`)
              await load()
            } catch (e) { alert((e as Error).message) }
          }}
        >
          一键设置全部额度
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">账号（手机号）</th>
              <th className="px-4 py-3 font-medium">昵称</th>
              <th className="px-4 py-3 font-medium">注册时间</th>
              <th className="px-4 py-3 text-right font-medium">生成额度</th>
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
                  <td className="num px-4 py-3 text-right">
                    <button
                      className="hover:text-flame"
                      title="点击修改该学员的生成额度"
                      onClick={async () => {
                        const v = prompt(`「${s.nickname ?? s.email}」的生成额度（当前 ${s.genLimit ?? '不限'}，已用 ${s.genUsed}）。填条数；-1 = 不限`, String(s.genLimit ?? -1))
                        if (v === null || v.trim() === '') return
                        const n = Number(v.trim())
                        if (!Number.isInteger(n) || n < -1) { alert('请输入 -1、0 或正整数'); return }
                        const reset = s.genUsed > 0 && n !== -1 ? confirm('同时把已用次数清零吗？（续费场景选"确定"）') : false
                        try {
                          await api(`/api/admin/students/${s.id}`, { method: 'PATCH', body: { action: 'set-gen-limit', limit: n === -1 ? null : n, resetUsed: reset } })
                          await load()
                        } catch (e) { alert((e as Error).message) }
                      }}
                    >
                      {s.genLimit == null ? `不限（已用 ${s.genUsed}）` : `${s.genUsed}/${s.genLimit}`}
                    </button>
                  </td>
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
                    <td colSpan={7} className="bg-surface2 px-4 py-3">
                      {works === null ? <p className="text-ink3">加载中…</p>
                        : works.length === 0 ? <p className="text-ink3">该学员暂无作品</p>
                        : (
                          <ul className="space-y-1.5">
                            {works.map((t) => (
                              <li key={t.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                                <span className="min-w-0 truncate">{t.subject} <span className="num text-xs text-ink3">{t.framework?.name ?? '框架'}</span></span>
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

      {showAdd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => { if (!addBusy) setShowAdd(false) }}>
          <div className="card w-full max-w-sm space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-bold">新增账号</h3>
              <p className="mt-1 text-sm text-ink3">创建学员或运营账号</p>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">角色</span>
                <select className="field" value={newRole} onChange={(e) => setNewRole(e.target.value as 'student' | 'operator')}>
                  <option value="student">学员</option>
                  <option value="operator">运营</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">{newRole === 'student' ? '手机号（11 位数字）' : '账号（手机号或邮箱）'}</span>
                <input
                  className="field" type="text" value={newEmail}
                  onChange={(e) => {
                    // 学员账号只收数字：非数字键入直接丢弃，长度锁 11 位——
                    // 让"格式不对"在输入时就不可能发生，而不是提交时才报错
                    const v = newRole === 'student' ? e.target.value.replace(/\D/g, '').slice(0, 11) : e.target.value
                    setNewEmail(v)
                  }}
                  placeholder={newRole === 'student' ? '13800000000' : '13800000000 或 name@example.com'}
                  autoCapitalize="none" inputMode={newRole === 'student' ? 'numeric' : 'email'}
                  maxLength={newRole === 'student' ? 11 : undefined} autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">昵称（可选）</span>
                <input className="field" type="text" value={newNickname} onChange={(e) => setNewNickname(e.target.value)} placeholder="显示昵称" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink3">初始密码</span>
                <input className="field" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 8 位" />
              </label>
            </div>
            {addErr && <p className="pill pill-bad">{addErr}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="btn-ghost px-4">取消</button>
              <button onClick={createAccount} disabled={addBusy} className="btn-primary px-5">{addBusy ? '创建中…' : '确认创建'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
