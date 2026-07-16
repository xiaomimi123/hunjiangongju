'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import { GenPill } from '../../genStatus'

type Segment = { seqNo: number; scriptText: string; imageUrl: string | null }
type GenTask = {
  id: string; subject: string; status: string; variables: Record<string, unknown> | null
  framework: { id: string; name: string | null } | null
  segments: Segment[]
}
type Bgm = { id: string; fileUrl: string; styleTag: string | null }

export default function GenerateEditPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [task, setTask] = useState<GenTask | null>(null)
  const [bgms, setBgms] = useState<Bgm[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})       // 每段文案草稿
  const [bump, setBump] = useState<Record<number, number>>({})            // 换图后刷新预览
  const [bgmId, setBgmId] = useState<string>('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const imgRefs = useRef<Record<number, HTMLInputElement | null>>({})

  const load = useCallback(async () => {
    try {
      const t = await api<GenTask>(`/api/generate/${id}`)
      setTask(t)
      setDrafts(Object.fromEntries(t.segments.map((s) => [s.seqNo, s.scriptText])))
      setBgmId((t.variables?.__bgmId as string) ?? '')
      return t
    } catch (e) { setErr((e as Error).message); return null }
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { api<Bgm[]>('/api/bgm').then(setBgms).catch(() => {}) }, [])

  if (!task && err) {
    return (
      <div className="space-y-4">
        <p className="pill pill-bad">{err}</p>
        <Link href="/admin/generate" className="text-sm text-flame">← 返回生成列表</Link>
      </div>
    )
  }
  if (!task) return <p className="py-16 text-center text-sm text-ink3">加载中…</p>

  const editable = task.status === 'ASSET_READY'
  const changedSeqs = task.segments.filter((s) => (drafts[s.seqNo] ?? '') !== s.scriptText).map((s) => s.seqNo)

  async function changeImage(seqNo: number, file: File) {
    setErr(''); setMsg(''); setBusy(`img-${seqNo}`)
    try {
      const fd = new FormData()
      fd.append('image', file)
      await api(`/api/generate/${id}/segments/${seqNo}`, { method: 'PATCH', form: fd })
      setBump((b) => ({ ...b, [seqNo]: Date.now() }))
      setMsg(`第 ${seqNo} 段配图已更新（换图不影响时轴，无需重对齐）`)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  async function saveTextAndRealign() {
    if (changedSeqs.length === 0) { setErr('没有改动的文案'); return }
    setErr(''); setMsg(''); setBusy('realign')
    try {
      for (const seqNo of changedSeqs) {
        const fd = new FormData()
        fd.append('scriptText', drafts[seqNo] ?? '')
        await api(`/api/generate/${id}/segments/${seqNo}`, { method: 'PATCH', form: fd })
      }
      await api(`/api/generate/${id}/realign`, { method: 'POST' })
      router.push(`/admin/generate/${id}`)   // 回详情页观察重对齐进度
    } catch (e) { setErr((e as Error).message); setBusy('') }
  }

  async function saveBgm(next: string) {
    setBgmId(next); setErr(''); setMsg(''); setBusy('bgm')
    try {
      await api(`/api/generate/${id}/bgm`, { method: 'POST', body: { bgmId: next || null } })
      setMsg(next ? '已选定 BGM（下次合成生效）' : '已清除 BGM')
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={`编辑素材包 · ${task.subject}`} subtitle={task.framework?.name ? `框架：${task.framework.name}` : undefined}>
        <Link href={`/admin/generate/${id}`} className="btn-ghost">返回详情</Link>
      </PageHeader>
      {err && <p className="pill pill-bad">{err}</p>}
      {msg && <p className="pill pill-ok">{msg}</p>}

      {!editable && (
        <div className="card flex items-center gap-3 p-4">
          <span className="eyebrow">当前状态</span>
          <GenPill status={task.status} />
          <span className="text-sm text-ink3">仅在「素材就绪」时可编辑，处理完成后再来。</span>
        </div>
      )}

      {/* 换 BGM */}
      <div className="card space-y-2 p-4">
        <p className="eyebrow">合成 BGM</p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={bgmId} disabled={!editable || busy === 'bgm'} onChange={(e) => saveBgm(e.target.value)} className="field max-w-xs">
            <option value="">不使用 BGM</option>
            {bgms.map((b) => <option key={b.id} value={b.id}>{b.styleTag || '未标注'} · {b.id.slice(0, 8)}</option>)}
          </select>
          {bgmId && bgms.find((b) => b.id === bgmId) && (
            <audio controls src={bgms.find((b) => b.id === bgmId)!.fileUrl} className="h-9" />
          )}
          <Link href="/admin/bgm" className="text-xs text-flame">管理曲库 →</Link>
        </div>
      </div>

      {/* 分段编辑 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow">分段（{task.segments.length}）· 改文案需重对齐，换图即时生效</p>
          <button onClick={saveTextAndRealign} disabled={!editable || busy === 'realign' || changedSeqs.length === 0}
            className="btn-primary disabled:opacity-50">
            {busy === 'realign' ? '保存并重对齐中…' : `保存文案并重新对齐${changedSeqs.length ? `（${changedSeqs.length}）` : ''}`}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {task.segments.map((s) => {
            const v = bump[s.seqNo]
            const src = s.imageUrl ? `${s.imageUrl}${v ? `?t=${v}` : ''}` : null
            return (
              <div key={s.seqNo} className="card overflow-hidden">
                <div className="relative aspect-[3/4] bg-surface2">
                  {src
                    ? <img src={src} alt={`第${s.seqNo}段`} className="h-full w-full object-cover" />
                    : <div className="grid h-full w-full place-items-center text-xs text-ink3">无配图</div>}
                  <span className="num absolute left-2 top-2 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] text-white">#{s.seqNo}</span>
                </div>
                <div className="space-y-2 p-3">
                  <textarea value={drafts[s.seqNo] ?? ''} disabled={!editable}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.seqNo]: e.target.value }))}
                    rows={3} className="field w-full resize-none text-sm" />
                  <input ref={(el) => { imgRefs.current[s.seqNo] = el }} type="file" accept="image/*" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) changeImage(s.seqNo, f); e.target.value = '' }} />
                  <button onClick={() => imgRefs.current[s.seqNo]?.click()} disabled={!editable || busy === `img-${s.seqNo}`}
                    className="btn-ghost w-full text-xs disabled:opacity-50">
                    {busy === `img-${s.seqNo}` ? '上传中…' : '换图'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
