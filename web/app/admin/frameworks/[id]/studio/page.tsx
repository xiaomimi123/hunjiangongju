'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/fetcher'
import PageHeader from '@/components/admin/PageHeader'
import {
  SlotRows, TransitionRows, MotionRows, CaptionStyleRows, AudioRows, TextRows, PaceRows, ScriptRows,
  type Cycle, type Keyframe, type AudioParams, type TextParams, type PaceParams, type ScriptParams, type FontOption,
} from '@/components/admin/paramControls'

// 框架级剪辑工作台：调**这个模板以后所有片子**的节奏、转场、运镜、字幕、配乐。
//
// 与任务级工作台（/admin/generate/[id]/studio）的分工：
//   - 已经知道客户要什么数值 → 在这里直接改，一次到位。
//   - 不确定改成什么好 → 先在任务级调、看成片，满意了点「保存为模板默认值」写回来。
// 两边用同一套控件、同一份白名单，能调的字段完全一致。

type Effective = {
  mode: string
  transition: { durationMs: number; bodyCycle?: Cycle[] }
  body: { slotDurationsMs?: number[]; subtitleColor: string; subtitlePosY: number }
  audio: AudioParams
  motion?: { keyframes?: Keyframe[] }
  text?: TextParams & Record<string, number | string>
  pace?: PaceParams
  script?: ScriptParams
}
type Info = { name: string | null; effective: Effective; hasDraftParams: boolean }

export default function FrameworkStudioPage() {
  const { id } = useParams<{ id: string }>()
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  const [slots, setSlots] = useState<number[]>([])
  const [cycle, setCycle] = useState<Cycle[]>([])
  const [kfs, setKfs] = useState<Keyframe[]>([])
  const [audio, setAudio] = useState<AudioParams | null>(null)
  const [capColor, setCapColor] = useState('#ffffff')
  const [capPosY, setCapPosY] = useState(0.78)
  const [text, setText] = useState<TextParams | null>(null)
  const [pace, setPace] = useState<PaceParams | null>(null)
  const [script, setScript] = useState<ScriptParams | null>(null)
  const [fonts, setFonts] = useState<FontOption[]>([])

  const load = useCallback(async () => {
    try {
      const [d, fontsRes] = await Promise.all([
        api<Info>(`/api/frameworks/${id}/params`),
        api<{ builtin: { id: string; label: string; family: string }[]; custom: { id: string; label: string; family: string }[] }>('/api/admin/fonts').catch(() => ({ builtin: [], custom: [] })),
      ])
      setFonts([
        ...fontsRes.builtin.map((f) => ({ ...f, builtin: true })),
        ...fontsRes.custom.map((f) => ({ ...f, builtin: false })),
      ])
      setInfo(d)
      setSlots(d.effective.body.slotDurationsMs ?? [])
      setCycle(d.effective.transition.bodyCycle ?? [])
      setKfs(d.effective.motion?.keyframes ?? [])
      setAudio({ ...d.effective.audio })
      setCapColor(d.effective.body.subtitleColor)
      setCapPosY(d.effective.body.subtitlePosY)
      if (d.effective.text) setText(d.effective.text as TextParams)
      if (d.effective.pace) setPace({ ...d.effective.pace })
      if (d.effective.script) setScript({ ...d.effective.script })
    } catch (e) { setErr((e as Error).message) }
  }, [id])

  useEffect(() => { load() }, [load])

  if (!info) {
    return err
      ? <div className="space-y-4"><p className="pill pill-bad">{err}</p>
          <Link href="/admin/frameworks" className="text-sm text-flame">← 返回框架库</Link></div>
      : <p className="py-16 text-center text-sm text-ink3">加载中…</p>
  }

  async function save(patch: Record<string, unknown>, what: string) {
    setErr(''); setMsg(''); setBusy(what)
    try {
      await api(`/api/frameworks/${id}/params`, { method: 'PATCH', body: patch })
      await load()
      setMsg(`${what}已保存。以后用这个框架生成的片子都按新参数来（已生成的不受影响）。`)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  const Section = (p: { title: string; what: string; patch: () => Record<string, unknown>; children: React.ReactNode }) => (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{p.title}</p>
        <button className="btn-ghost text-xs disabled:opacity-50" disabled={!!busy}
          onClick={() => save(p.patch(), p.what)}>
          {busy === p.what ? '保存中…' : `保存${p.what}`}
        </button>
      </div>
      {p.children}
    </section>
  )

  return (
    <div className="space-y-5">
      <PageHeader title={`框架剪辑参数 · ${info.name || '未命名'}`}
        subtitle="改这里影响以后所有用该框架生成的片子；已经生成的不受影响">
        <Link href="/admin/frameworks" className="btn-ghost">返回框架库</Link>
      </PageHeader>

      {err && <p className="pill pill-bad">{err}</p>}
      {msg && <p className="pill pill-ok">{msg}</p>}
      {!info.hasDraftParams && (
        <p className="pill pill-warn">
          这个框架没有从剪映草稿解析过参数，下面显示的都是系统默认值。保存后即成为该框架的设定。
        </p>
      )}

      <div className="card p-4 text-xs text-ink3">
        不确定改成什么合适时，建议先用这个框架生成一条，在
        <span className="text-ink">「生成 → 剪辑工作台」</span>里边看边调，满意后点
        <span className="text-ink">「保存为模板默认值」</span>写回这里——那样能看着成片改，不用凭空猜数值。
      </div>

      <Section title="节奏 · 每段停留多久（默认值）" what="节奏"
        patch={() => ({ body: { slotDurationsMs: slots } })}>
        <p className="text-xs text-ink3">
          这是**文案配额与配音时长的目标**：文案按各段时长比例分字数，配音再补静音/变速对齐到它。
          单条片子画面的实际切点由配音对齐算出，因此改这里会通过下一条新生成的片子体现出来。
        </p>
        <SlotRows slots={slots} onChange={setSlots} />
        <button className="btn-ghost text-xs" onClick={() => setSlots((s) => [...s, 5000])}>+ 增加一段</button>
      </Section>

      <Section title="转场 · 正片各边界" what="转场"
        patch={() => ({ transition: { bodyCycle: cycle } })}>
        <TransitionRows cycle={cycle} onChange={setCycle} />
      </Section>

      <Section title="运镜 · 逐段推近幅度" what="运镜"
        patch={() => ({ motion: { keyframes: kfs } })}>
        <MotionRows kfs={kfs} onChange={setKfs} />
      </Section>

      <Section title="字幕样式" what="字幕样式"
        patch={() => ({ body: { subtitleColor: capColor, subtitlePosY: capPosY }, ...(text ? { text } : {}) })}>
        <CaptionStyleRows color={capColor} posY={capPosY} onColor={setCapColor} onPosY={setCapPosY}
          text={text} onText={setText} />
      </Section>

      {text && (
        <Section title="文字层 · 字号 / 描边 / 加粗 / 颜色" what="文字层"
          patch={() => ({ text })}>
          <TextRows text={text} onChange={setText} fonts={fonts} />
        </Section>
      )}

      {pace && (
        <Section title="节奏留白与语速" what="节奏留白"
          patch={() => ({ pace })}>
          <PaceRows pace={pace} onChange={setPace} />
        </Section>
      )}

      {script && (
        <Section title="文案口径（给 AI 的规则）" what="文案口径"
          patch={() => ({ script })}>
          <ScriptRows script={script} onChange={setScript} />
        </Section>
      )}

      {audio && (
        <Section title="配乐" what="配乐" patch={() => ({ audio })}>
          <p className="text-xs text-ink3">
            换曲子在框架库编辑里选「默认 BGM」，或在单条片子的工作台里换。这里只管音量与剪法。
          </p>
          <AudioRows audio={audio} onChange={setAudio} />
        </Section>
      )}
    </div>
  )
}
