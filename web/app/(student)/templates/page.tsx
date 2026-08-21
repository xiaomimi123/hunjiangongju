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
  /** 该框架开放给学员的配音音色。空数组表示不开放，此时不显示选择项 */
  voices?: { id: string; label: string }[]
  defaultVoice?: string
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
  const [voice, setVoice] = useState('')
  const [sheetErr, setSheetErr] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api<Framework[]>('/api/library/frameworks').then(setFrameworks).catch((e) => setErr((e as Error).message))
  }, [])

  function open(f: Framework) {
    setSheetErr(''); setSubject(''); setTitle(''); setSubtitle(''); setAccount('')
    // 缺省选中框架指定的默认音色；没指定就用第一个（下拉里始终有选中项，
    // 不留一个空选项让人以为"没选就没配音"）
    setVoice(f.defaultVoice ?? f.voices?.[0]?.id ?? '')
    setPicked(f)
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
      // 服务端只认框架名单里的音色，这里传了也不代表能用（见 restrictVoiceForNonOperator）
      if (voice.trim()) variables.voice = voice.trim()
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
              placeholder="填一个书名或主题，例如《被讨厌的勇气》或「治愈内耗」" />
            <p className="mt-1 text-xs text-ink3">系统会联网查证并自动配齐同主题的书目再生成文案，偶尔仍可能有误，发现不对可反馈</p>
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
          {/* 只有框架开放了音色才显示。没开放时不留一个空下拉——那会让人以为功能坏了 */}
          {picked?.voices && picked.voices.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">配音</p>
              <select className="field" value={voice} onChange={(e) => setVoice(e.target.value)}>
                {picked.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
          )}
          {sheetErr && <p className="pill pill-bad">{sheetErr}</p>}
          <button onClick={create} disabled={creating} className="btn-primary w-full">
            {creating ? '生成中…' : '⚡ 生成'}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
