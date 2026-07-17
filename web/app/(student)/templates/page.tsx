'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/fetcher'
import BottomSheet from '@/components/BottomSheet'

type Framework = {
  id: string
  name: string
  industryCategory: string | null
  suggestedSegmentCount: number | null
  imageStylePrompt: string | null
}

export default function FrameworkLibraryPage() {
  const router = useRouter()
  const [frameworks, setFrameworks] = useState<Framework[]>([])
  const [err, setErr] = useState('')

  const [picked, setPicked] = useState<Framework | null>(null)
  const [subject, setSubject] = useState('')
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [account, setAccount] = useState('')
  const [sheetErr, setSheetErr] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api<Framework[]>('/api/library/frameworks').then(setFrameworks).catch((e) => setErr((e as Error).message))
  }, [])

  function open(f: Framework) {
    setSheetErr(''); setSubject(''); setTitle(''); setSubtitle(''); setAccount(''); setPicked(f)
  }

  async function create() {
    if (!picked) return
    if (!subject.trim()) { setSheetErr('请填写选题'); return }
    setSheetErr(''); setCreating(true)
    try {
      const variables: Record<string, string> = {}
      if (title.trim()) variables['标题'] = title.trim()
      if (subtitle.trim()) variables['副标题'] = subtitle.trim()
      if (account.trim()) variables['账号'] = account.trim()
      const task = await api<{ id: string }>('/api/generate', {
        body: { frameworkId: picked.id, subject: subject.trim(), variables },
      })
      router.push(`/works/${task.id}`)
    } catch (e) { setSheetErr((e as Error).message); setCreating(false) }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">框架库</h1>
      <p className="text-sm text-ink3">选一个爆款框架，填个选题，自动出成片</p>
      {err && <p className="pill pill-bad">{err}</p>}

      <div className="space-y-2.5">
        {frameworks.map((f) => (
          <button key={f.id} onClick={() => open(f)}
            className="card flex w-full items-center justify-between gap-3 p-4 text-left transition active:scale-[0.99]">
            <div className="min-w-0">
              <p className="truncate font-medium">{f.name}</p>
              <p className="mt-0.5 truncate text-xs text-ink3">
                {f.industryCategory ?? '通用'}
                {f.suggestedSegmentCount ? <> · 约 <span className="num">{f.suggestedSegmentCount}</span> 段</> : null}
              </p>
            </div>
            <span className="grad shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">用它生成</span>
          </button>
        ))}
        {frameworks.length === 0 && !err && (
          <p className="card p-6 text-center text-sm text-ink3">暂无已发布的框架</p>
        )}
      </div>

      <BottomSheet open={!!picked} onClose={() => { if (!creating) setPicked(null) }} title={picked?.name ?? ''}>
        <div className="space-y-3">
          <div>
            <p className="eyebrow mb-1.5">选题 <span className="text-flame">*</span></p>
            <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="这条视频讲什么？例如「秋冬保暖内衣测评」" />
          </div>
          <div>
            <p className="eyebrow mb-1.5">标题（可选）</p>
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="视频主标题" />
          </div>
          <div>
            <p className="eyebrow mb-1.5">副标题（可选）</p>
            <input className="field" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="副标题 / 卖点" />
          </div>
          <div>
            <p className="eyebrow mb-1.5">账号（可选）</p>
            <input className="field" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="@你的账号" />
          </div>
          {sheetErr && <p className="pill pill-bad">{sheetErr}</p>}
          <button onClick={create} disabled={creating} className="btn-primary w-full">
            {creating ? '生成中…' : '⚡ 生成'}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
