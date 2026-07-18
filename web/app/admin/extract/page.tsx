'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import Modal from '@/components/admin/Modal'
import { ExtractPill, extractIsTerminal } from './extractStatus'

type Source = { id: string; douyinShareUrl: string; status: string; createdAt: string; frameworkCount: number }

export default function ExtractPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Source[] | null>(null)
  const [err, setErr] = useState('')

  const [open, setOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [modalErr, setModalErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { const r = await api<Source[]>('/api/extract'); setRows(r); return r }
    catch (e) { setErr((e as Error).message); return null }
  }, [])

  const [deleting, setDeleting] = useState('')
  async function del(id: string, label: string) {
    if (!confirm(`确定删除拆解「${label}」？将一并删除其转写、派生框架及框架下的生成任务，不可恢复。`)) return
    setDeleting(id)
    try { await api(`/api/extract/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setErr((e as Error).message) }
    finally { setDeleting('') }
  }

  useEffect(() => {
    load()
    const timer = setInterval(async () => {
      const r = await load()
      // 无在途拆解则停轮询
      if (r && !r.some((s) => !extractIsTerminal(s.status))) clearInterval(timer)
    }, 3000)
    return () => clearInterval(timer)
  }, [load])

  function openModal() {
    setModalErr(''); setShareUrl(''); setFile(null); setOpen(true)
  }

  async function submitLink() {
    setModalErr('')
    if (!shareUrl.trim() || !shareUrl.includes('http')) { setModalErr('请粘贴有效的抖音分享链接'); return }
    setBusy(true)
    try {
      const r = await api<{ id: string }>('/api/extract/from-link', { body: { shareUrl: shareUrl.trim() } })
      router.push(`/admin/extract/${r.id}`)
    } catch (e) { setModalErr((e as Error).message); setBusy(false) }
  }

  async function submitUpload() {
    setModalErr('')
    if (!file) { setModalErr('请选择视频文件'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api<{ id: string }>('/api/extract/upload', { form: fd })
      router.push(`/admin/extract/${r.id}`)
    } catch (e) { setModalErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="视频拆解" subtitle="粘贴抖音分享链接或上传视频，自动转写 + 提炼可复用文案框架">
        <button onClick={openModal} className="btn-primary">发起拆解</button>
      </PageHeader>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-left text-ink3">
            <tr>
              <th className="px-4 py-3 font-medium">来源</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">产出框架</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows?.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-surface2" onClick={() => router.push(`/admin/extract/${s.id}`)}>
                <td className="px-4 py-3">
                  <Link href={`/admin/extract/${s.id}`} className="font-medium text-flame">
                    {s.douyinShareUrl === '(manual-upload)' ? '手动上传' : s.douyinShareUrl}
                  </Link>
                </td>
                <td className="px-4 py-3"><ExtractPill status={s.status} /></td>
                <td className="num px-4 py-3 text-ink2">{s.frameworkCount}</td>
                <td className="num px-4 py-3 text-ink3">{new Date(s.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => del(s.id, s.douyinShareUrl === '(manual-upload)' ? '手动上传' : s.douyinShareUrl)}
                    disabled={deleting === s.id}
                    className="text-xs text-ink3 hover:text-flame disabled:opacity-50">
                    {deleting === s.id ? '删除中…' : '删除'}
                  </button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink3">暂无拆解任务，点击右上角「发起拆解」</td></tr>
            )}
            {!rows && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink3">加载中…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="发起拆解">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="eyebrow">方式一 · 粘贴抖音分享链接（best-effort）</p>
            <input className="field" value={shareUrl} onChange={(e) => setShareUrl(e.target.value)}
              placeholder="粘贴抖音 App「分享 → 复制链接」的内容" />
            <button onClick={submitLink} disabled={busy} className="btn-primary w-full">{busy ? '发起中…' : '解析链接并拆解'}</button>
          </div>

          <div className="flex items-center gap-3 text-xs text-ink3">
            <span className="h-px flex-1 bg-line" />或<span className="h-px flex-1 bg-line" />
          </div>

          <div className="space-y-2">
            <p className="eyebrow">方式二 · 上传视频（可靠主路径）</p>
            <input ref={fileRef} type="file" accept="video/*" hidden
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
            <div onClick={() => fileRef.current?.click()}
              className="grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-line bg-surface2/50 px-4 py-6 text-center transition hover:border-flame/50">
              <p className="text-2xl">🎬</p>
              <p className="mt-1 text-sm text-ink2">
                {file ? <span className="font-medium text-flame">{file.name}</span> : <>点击选择视频文件（mp4 / mov / webm）</>}
              </p>
            </div>
            <button onClick={submitUpload} disabled={busy || !file} className="btn-primary w-full">{busy ? '上传中…' : '上传并拆解'}</button>
          </div>

          {modalErr && <p className="pill pill-bad">{modalErr}</p>}
        </div>
      </Modal>
    </div>
  )
}
