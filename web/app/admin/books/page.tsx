'use client'
import { useCallback, useEffect, useId, useState } from 'react'
import { api } from '@/lib/fetcher'
import { thumbUrl } from '@/lib/thumbUrl'
import PageHeader from '@/components/admin/PageHeader'

type Book = {
  id: string
  title: string
  author: string
  coverUrl: string | null
  coverSource: string | null
  theme: string | null
  points: string | null
  source: string
  createdAt: string
}
type ListResp = { books: Book[]; themes: string[] }

const emptyForm = { title: '', author: '', theme: '', points: '' }

/**
 * 书库里的封面单元格：上传真实封面 / AI 生成 / 清除。
 *
 * 为什么把封面放在书库而不是每条片子现做：书封只跟「这本书」有关，
 * 跟这条片子的文案毫无关系。原先每条片子都为每本书重生成一张——
 * 9 本书就是 9 次生图调用，而其中绝大多数是同样那几本常见书。
 *
 * 上传真实封面与原工程一致（客户草稿里的快闪图本来就是真实书封），也最准；
 * AI 生成的是「无文字的封面底图」，书名由渲染层叠字。
 */
function BookCover({ book, onChange }: { book: Book; onChange: () => void }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const id = useId()

  async function call(init: RequestInit, tag: string) {
    setBusy(tag); setErr('')
    try {
      const res = await fetch(`/api/admin/books/${book.id}/cover`, init)
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }

  return (
    <div className="w-24">
      {book.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl(book.coverUrl)} alt={book.title} className="h-20 w-full rounded border border-line object-cover" />
      ) : (
        <div className="flex h-20 w-full items-center justify-center rounded border border-dashed border-line text-[11px] text-ink3">无封面</div>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        <label htmlFor={id} className={`btn-ghost px-1.5 py-0.5 text-[11px] ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
          {busy === 'up' ? '上传中…' : '上传'}
        </label>
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const fd = new FormData()
            fd.append('file', f)
            void call({ method: 'POST', body: fd }, 'up')
          }}
        />
        <button
          className="btn-ghost px-1.5 py-0.5 text-[11px]"
          disabled={!!busy}
          onClick={() => call({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 'ai')}
        >
          {busy === 'ai' ? '生成中…' : 'AI 生成'}
        </button>
        {book.coverUrl && (
          <button className="btn-ghost px-1.5 py-0.5 text-[11px]" disabled={!!busy} onClick={() => call({ method: 'DELETE' }, 'del')}>
            清除
          </button>
        )}
      </div>
      {book.coverSource && <p className="mt-0.5 text-[10px] text-ink3">{book.coverSource === 'upload' ? '上传' : 'AI'}</p>}
      {err && <p className="mt-0.5 break-all text-[10px] text-red-500">{err}</p>}
    </div>
  )
}

export default function BooksPage() {
  const [books, setBooks] = useState<Book[] | null>(null)
  const [themes, setThemes] = useState<string[]>([])
  const [filterTheme, setFilterTheme] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [editingId, setEditingId] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const [editTheme, setEditTheme] = useState('')
  const [editPoints, setEditPoints] = useState('')

  const load = useCallback(async (theme: string) => {
    try {
      const q = theme ? `?theme=${encodeURIComponent(theme)}` : ''
      const r = await api<ListResp>(`/api/admin/books${q}`)
      setBooks(r.books)
      setThemes(r.themes)
    } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load(filterTheme) }, [load, filterTheme])

  async function create() {
    setErr('')
    const title = form.title.trim()
    const author = form.author.trim()
    if (!title || !author) { setErr('书名与作者不能为空'); return }
    setBusy(true)
    try {
      await api('/api/admin/books', {
        method: 'POST',
        body: {
          title,
          author,
          theme: form.theme.trim() || undefined,
          points: form.points.trim() || undefined,
        },
      })
      setForm(emptyForm)
      await load(filterTheme)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  async function del(id: string) {
    if (!confirm('确认删除该书目？删除后 AI 选书将不再复用这条记录。')) return
    setErr('')
    try { await api(`/api/admin/books/${id}`, { method: 'DELETE' }); await load(filterTheme) }
    catch (e) { setErr((e as Error).message) }
  }

  function startEdit(b: Book) {
    setEditingId(b.id)
    setEditTitle(b.title)
    setEditAuthor(b.author)
    setEditTheme(b.theme ?? '')
    setEditPoints(b.points ?? '')
  }
  function cancelEdit() {
    setEditingId('')
    setEditTitle('')
    setEditAuthor('')
    setEditTheme('')
    setEditPoints('')
  }
  async function saveEdit(id: string) {
    setErr('')
    const title = editTitle.trim()
    const author = editAuthor.trim()
    if (!title || !author) { setErr('书名与作者不能为空'); return }
    try {
      await api(`/api/admin/books/${id}`, {
        method: 'PATCH',
        body: { title, author, theme: editTheme.trim(), points: editPoints.trim() },
      })
      cancelEdit()
      await load(filterTheme)
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="书库" subtitle="AI 选书结果与人工新增的 书名+作者 沉淀在此，联网查证仍可能出错，发现问题在这里改或删" />
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card space-y-3 p-4">
        <p className="eyebrow">新增书目</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">书名</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 活着"
              className="field w-40" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">作者</span>
            <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="如 余华"
              className="field w-32" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">主题（可选）</span>
            <input value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} placeholder="如 文学"
              className="field w-32" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink3">要点（可选）</span>
            <input value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} placeholder="核心卖点/摘要"
              className="field w-56" />
          </label>
          <button onClick={create} disabled={busy} className="btn-primary">
            {busy ? '新增中…' : '＋ 新增'}
          </button>
        </div>
        <p className="text-xs text-ink3">书名会自动去除书名号《》并去除首尾空白；同一 书名+作者 不能重复新增。</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="eyebrow">主题筛选</span>
        <select className="field w-48" value={filterTheme} onChange={(e) => setFilterTheme(e.target.value)}>
          <option value="">全部</option>
          {themes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <section className="space-y-3">
        <p className="eyebrow">书目（{books?.length ?? 0}）</p>
        {books && books.length === 0 && (
          <p className="card p-6 text-center text-sm text-ink3">还没有书目，等 AI 选书沉淀，或者在上面手动新增一条。</p>
        )}
        {!books && <p className="card p-6 text-center text-sm text-ink3">加载中…</p>}
        {books && books.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink3">
                  <th className="py-2 pr-3">封面</th>
                  <th className="py-2 pr-3">书名</th>
                  <th className="py-2 pr-3">作者</th>
                  <th className="py-2 pr-3">主题</th>
                  <th className="py-2 pr-3">要点</th>
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id} className="border-b border-line/60">
                    {editingId === b.id ? (
                      <>
                        <td className="py-2 pr-3 text-ink3">—</td>
                        <td className="py-2 pr-3"><input className="field w-full text-xs" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="书名" /></td>
                        <td className="py-2 pr-3"><input className="field w-full text-xs" value={editAuthor} onChange={(e) => setEditAuthor(e.target.value)} placeholder="作者" /></td>
                        <td className="py-2 pr-3"><input className="field w-full text-xs" value={editTheme} onChange={(e) => setEditTheme(e.target.value)} placeholder="主题" /></td>
                        <td className="py-2 pr-3"><input className="field w-full text-xs" value={editPoints} onChange={(e) => setEditPoints(e.target.value)} placeholder="要点" /></td>
                        <td className="py-2 pr-3 text-ink3">{b.source}</td>
                        <td className="py-2 pr-3">
                          <div className="flex justify-end gap-1.5">
                            <button onClick={cancelEdit} className="btn-ghost px-2 py-1 text-xs">取消</button>
                            <button onClick={() => saveEdit(b.id)} className="btn-primary px-2 py-1 text-xs">保存</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 pr-3"><BookCover book={b} onChange={() => load(filterTheme)} /></td>
                        <td className="py-2 pr-3 font-medium">{b.title}</td>
                        <td className="py-2 pr-3">{b.author}</td>
                        <td className="py-2 pr-3 text-ink3">{b.theme || '—'}</td>
                        <td className="max-w-xs truncate py-2 pr-3 text-ink3" title={b.points ?? ''}>{b.points || '—'}</td>
                        <td className="py-2 pr-3 text-ink3">{b.source === 'ai' ? 'AI' : '人工'}</td>
                        <td className="py-2 pr-3">
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => startEdit(b)} className="btn-ghost px-2 py-1 text-xs">编辑</button>
                            <button onClick={() => del(b.id)} className="btn-danger px-2 py-1 text-xs">删除</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
