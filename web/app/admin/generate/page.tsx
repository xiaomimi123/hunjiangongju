'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'
import { GenPill } from './genStatus'

type Framework = { id: string; name: string | null; industryCategory: string | null; visualStyleType: string; createdAt: string }
type GenTask = { id: string; subject: string; status: string; createdAt: string; updatedAt: string; framework: { name: string | null } | null }
type BookRow = { title: string; author: string; points: string }
type Mode = 'subject' | 'books'

const EMPTY_BOOK_ROW: BookRow = { title: '', author: '', points: '' }

export default function GeneratePage() {
  const router = useRouter()
  const [tasks, setTasks] = useState<GenTask[] | null>(null)
  const [err, setErr] = useState('')

  const [open, setOpen] = useState(false)
  const [frameworks, setFrameworks] = useState<Framework[]>([])
  const [frameworkId, setFrameworkId] = useState('')
  const [subject, setSubject] = useState('')
  const [variables, setVariables] = useState('')
  const [mode, setMode] = useState<Mode>('subject')
  const [books, setBooks] = useState<BookRow[]>([{ ...EMPTY_BOOK_ROW }])
  const [modalErr, setModalErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setTasks(await api<GenTask[]>('/api/generate')) }
    catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  function openModal() {
    setModalErr(''); setSubject(''); setVariables(''); setFrameworkId('')
    setMode('subject'); setBooks([{ ...EMPTY_BOOK_ROW }])
    setOpen(true)
    api<Framework[]>('/api/frameworks').then((fw) => {
      setFrameworks(fw)
      if (fw[0]) setFrameworkId(fw[0].id)
    }).catch((e) => setModalErr((e as Error).message))
  }

  function updateBook(i: number, field: keyof BookRow, value: string) {
    setBooks((prev) => prev.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)))
  }
  function addBook() {
    setBooks((prev) => [...prev, { ...EMPTY_BOOK_ROW }])
  }
  function removeBook(i: number) {
    setBooks((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))
  }

  async function submit() {
    setModalErr('')
    if (!frameworkId) { setModalErr('请选择框架'); return }
    if (!subject.trim()) { setModalErr('请填写选题'); return }
    let vars: Record<string, unknown> | undefined
    if (mode === 'books') {
      const cleaned = books
        .map((b) => ({ title: b.title.trim(), author: b.author.trim(), points: b.points.trim() }))
        .filter((b) => b.title)
        .map((b) => ({ title: b.title, ...(b.author ? { author: b.author } : {}), ...(b.points ? { points: b.points } : {}) }))
      if (cleaned.length === 0) { setModalErr('手填书单模式下，请至少填写一本书的书名'); return }
      vars = { books: cleaned }
    } else if (variables.trim()) {
      try { vars = JSON.parse(variables) }
      catch { setModalErr('变量需为合法 JSON（如 {"标题":"测试书"}）'); return }
    }
    setBusy(true)
    try {
      const r = await api<{ id: string }>('/api/generate', { body: { frameworkId, subject: subject.trim(), variables: vars } })
      router.push(`/admin/generate/${r.id}`)
    } catch (e) { setModalErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="生成" subtitle="按框架发起 AI 书单号生成，跟踪流水线进度">
        <button onClick={openModal} className="btn-primary">发起生成</button>
      </PageHeader>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">选题</th>
              <th className="px-4 py-3 font-medium">框架</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tasks?.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-surface2" onClick={() => router.push(`/admin/generate/${t.id}`)}>
                <td className="px-4 py-3">
                  <Link href={`/admin/generate/${t.id}`} className="font-medium text-flame">{t.subject}</Link>
                </td>
                <td className="px-4 py-3 text-ink2">{t.framework?.name ?? '—'}</td>
                <td className="px-4 py-3"><GenPill status={t.status} /></td>
                <td className="num px-4 py-3 text-ink3">{new Date(t.createdAt).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
            {tasks && tasks.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-ink3">暂无生成任务，点击右上角「发起生成」</td></tr>
            )}
            {!tasks && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-ink3">加载中…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="发起生成" wide>
        <div className="space-y-4">
          <label className="block">
            <span className="eyebrow">框架</span>
            <select className="field mt-1" value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)}>
              {frameworks.length === 0 && <option value="">（暂无框架）</option>}
              {frameworks.map((f) => (
                <option key={f.id} value={f.id}>{f.name ?? f.id.slice(0, 8)}{f.industryCategory ? `（${f.industryCategory}）` : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="eyebrow">选题</span>
            <input className="field mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="例：活下去的理由" autoFocus />
          </label>

          <div className="block">
            <span className="eyebrow">生成模式</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setMode('subject')}
                className={mode === 'subject' ? 'btn-primary px-4 py-1.5 text-sm' : 'btn-ghost px-4 py-1.5 text-sm'}
              >
                选题自选（LLM 自己选书）
              </button>
              <button
                type="button"
                onClick={() => setMode('books')}
                className={mode === 'books' ? 'btn-primary px-4 py-1.5 text-sm' : 'btn-ghost px-4 py-1.5 text-sm'}
              >
                手填书单
              </button>
            </div>
          </div>

          {mode === 'books' ? (
            <div className="block space-y-2">
              <span className="eyebrow">书单（书名 / 作者 / 要点，逐本填写）</span>
              <div className="space-y-2">
                {books.map((b, i) => (
                  <div key={i} className="grid grid-cols-[1.1fr_0.9fr_1.3fr_auto] gap-2">
                    <input className="field" placeholder="书名（必填）" value={b.title} onChange={(e) => updateBook(i, 'title', e.target.value)} />
                    <input className="field" placeholder="作者（可选）" value={b.author} onChange={(e) => updateBook(i, 'author', e.target.value)} />
                    <input className="field" placeholder="要点（可选）" value={b.points} onChange={(e) => updateBook(i, 'points', e.target.value)} />
                    <button
                      type="button"
                      onClick={() => removeBook(i)}
                      disabled={books.length === 1}
                      className="btn-ghost px-2 text-xs disabled:opacity-40"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addBook} className="btn-ghost px-3 py-1 text-xs">+ 添加一本书</button>
            </div>
          ) : (
            <label className="block">
              <span className="eyebrow">变量（可选，JSON）</span>
              <textarea className="field mt-1 font-mono text-xs" rows={3} value={variables} onChange={(e) => setVariables(e.target.value)} placeholder='{"标题":"测试书","账号":"@测试"}' />
            </label>
          )}

          {modalErr && <p className="pill pill-bad">{modalErr}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} disabled={busy} className="btn-ghost px-4">取消</button>
            <button onClick={submit} disabled={busy} className="btn-primary px-5">{busy ? '发起中…' : '发起'}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
