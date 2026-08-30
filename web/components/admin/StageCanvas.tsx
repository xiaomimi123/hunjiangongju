'use client'
// 剪辑参数的所见即所得画布。
//
// ★ 它是**模拟器不是渲染器**。真正出片的是 worker 的 ass.ts + libass。
// 保真靠三条，缺一条这块画布就会开始骗人：
//   1. 坐标 1:1 零换算 —— 缩放只发生在最外层 transform: scale()，
//      内部一律用真实像素（720×1280 这一类）。画布上的每个数字**就是**存进参数的数字。
//      全部几何计算（top / 字号 / 是否显示）都在 stageGeometry.ts 里算好，
//      本文件只负责把算好的数字渲染成绝对定位的 div，不再做任何计算。
//   2. 共享 fitSizePx —— 长书名的缩排走 packages/db 里的那一份，与成片同一个函数
//      （stageGeometry.ts 里 import，这里不重复引用）。
//   3. 同一份字体二进制 —— 通过 GET /api/fonts/<id>/file 拿，就是 worker 渲染时
//      fontsdir 里的那个文件，用 FontFace API 动态注册后渲染。
// 仍然存在的差异：字距、CJK 断行位置、描边叠加顺序。所以画布角上常驻
// 「示意预览，最终以成片为准」。
//
// 本任务（Task 19）只做静态渲染：场景/底图可切换、字体真实加载、数值零换算，
// 但图层还不能拖拽（留给 Task 20），也不接入两个 studio 页（再下一个任务）。

import { useEffect, useRef, useState } from 'react'
import type { TextParams, FontOption } from './paramControls'
import { computeStageLayers, type StageScene, type StageLayer, type StageSample } from './stageGeometry'

export type { StageScene, StageLayer, StageSample }
export type StageBg = 'placeholder' | 'light' | 'dark' | { url: string }

const SCENES: { id: StageScene; label: string }[] = [
  { id: 'open', label: '开场' },
  { id: 'flash', label: '快闪' },
  { id: 'body', label: '正片' },
]

const BG_OPTIONS: { id: Exclude<StageBg, { url: string }>; label: string }[] = [
  { id: 'placeholder', label: '占位灰' },
  { id: 'light', label: '亮底' },
  { id: 'dark', label: '暗底' },
]

function bgKey(bg: StageBg): string {
  return typeof bg === 'string' ? bg : `url:${bg.url}`
}

function bgStyle(bg: StageBg): React.CSSProperties {
  if (typeof bg === 'string') {
    if (bg === 'light') return { background: '#f2f2f2' }
    if (bg === 'dark') return { background: '#141414' }
    // placeholder：中性灰渐变，既不偏亮也不偏暗，纯粹用来看清描边/字形
    return { background: 'linear-gradient(135deg, #4b4b4b, #2b2b2b)' }
  }
  return { backgroundImage: `url(${bg.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
}

/** 字体族名：按 id 在 fonts 里查，查不到回退 undefined（浏览器默认字体） */
function familyOf(fonts: FontOption[], id: string | undefined): string | undefined {
  if (!id) return undefined
  return fonts.find((f) => f.id === id)?.family
}

export function StageCanvas(props: {
  width: number
  height: number
  text: TextParams
  captionColor: string
  captionPosY: number
  fonts: FontOption[]
  scene: StageScene
  onScene: (s: StageScene) => void
  bg: StageBg
  onBg: (b: StageBg) => void
  sample: StageSample
  selected: StageLayer | null
  onSelect: (l: StageLayer | null) => void
  // 本任务只做静态渲染，拖拽（消费 onPosY/onSize）留给 Task 20；
  // 参数先按最终契约收进来，避免下个任务改 props 形状。
  onPosY: (layer: StageLayer, v: number) => void
  onSize: (layer: StageLayer, v: number) => void
}) {
  const { width, height, text, captionColor, captionPosY, fonts, scene, sample } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [fileBgUrl, setFileBgUrl] = useState<string | null>(null)

  // 坐标 1:1：缩放只发生在这一层，内部 children 全部用真实像素定位。
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const update = () => setScale(box.clientWidth > 0 ? box.clientWidth / width : 1)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(box)
    return () => ro.disconnect()
  }, [width])

  // 同一份字体二进制：与 worker fontsdir 里的文件一致，动态注册后渲染。
  useEffect(() => {
    let cancelled = false
    for (const f of fonts) {
      const face = new FontFace(f.family, `url(/api/fonts/${f.id}/file)`)
      face
        .load()
        .then((loaded) => {
          if (!cancelled) document.fonts.add(loaded)
        })
        .catch(() => {
          // 加载失败就回退浏览器默认字体——不能让一个字体坏掉整块画布
        })
    }
    return () => {
      cancelled = true
    }
  }, [fonts])

  const captionFamily = familyOf(fonts, text.captionFontId)
  const titleFamily = familyOf(fonts, text.titleFontId) ?? captionFamily
  const enFamily = familyOf(fonts, text.enFontId) ?? captionFamily

  const layers = computeStageLayers({ width, height, scene, text, captionPosY, sample })

  // -webkit-text-stroke 是**居中描边**（一半盖住字身内侧、一半在外侧），
  // 而 ASS 的 Outline 是纯外描边——同一个数字画出来外描边观感只有一半宽，
  // 所以这里 ×2 才接近 ass.ts 实际烧出来的粗细。
  const strokePx = text.outlinePx * 2
  const textStroke: React.CSSProperties = {
    WebkitTextStroke: `${strokePx}px #000`,
    paintOrder: 'stroke fill',
  }

  const selectable = (layer: StageLayer): React.HTMLAttributes<HTMLDivElement> => ({
    onClick: (e) => {
      e.stopPropagation()
      props.onSelect(layer)
    },
    style: { cursor: 'pointer', outline: props.selected === layer ? '1px dashed #ff8a3d' : undefined },
  })

  return (
    <div>
      <div className="mb-2 flex items-center gap-4" data-testid="stage-scene-tabs">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`btn-ghost text-xs ${scene === s.id ? 'text-flame' : ''}`}
            onClick={() => props.onScene(s.id)}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2" data-testid="stage-bg-picker">
          {BG_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`btn-ghost text-xs ${bgKey(props.bg) === o.id ? 'text-flame' : ''}`}
              onClick={() => props.onBg(o.id)}
            >
              {o.label}
            </button>
          ))}
          <label className="btn-ghost cursor-pointer text-xs">
            上传底图
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                // 仅本地预览：URL.createObjectURL，不上传服务器、不入参数、不入库。
                if (fileBgUrl) URL.revokeObjectURL(fileBgUrl)
                const url = URL.createObjectURL(file)
                setFileBgUrl(url)
                props.onBg({ url })
              }}
            />
          </label>
        </span>
      </div>

      <div ref={boxRef} className="relative w-full overflow-hidden rounded border border-line" style={{ height: height * scale }}>
        <div
          className="absolute left-0 top-0"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          onClick={() => props.onSelect(null)}
        >
          <div className="absolute inset-0" data-testid="stage-bg" style={bgStyle(props.bg)} />

          {layers.map((l) => {
            switch (l.layer) {
            case 'caption': {
              return (
                <div key="caption" data-testid="layer-caption">
                  <div
                    {...selectable('caption')}
                    className="absolute whitespace-nowrap"
                    style={{
                      left: '50%',
                      top: l.zh.top,
                      transform: 'translate(-50%, -100%)',
                      fontSize: l.zh.fontSizePx,
                      color: captionColor,
                      fontFamily: captionFamily,
                      ...textStroke,
                    }}
                  >
                    {l.zh.text}
                  </div>
                  {l.en && (
                    <div
                      className="absolute whitespace-nowrap"
                      style={{
                        left: '50%',
                        top: l.en.top,
                        transform: 'translate(-50%, 0)',
                        fontSize: l.en.fontSizePx,
                        color: text.enColor,
                        fontFamily: enFamily,
                        ...textStroke,
                      }}
                    >
                      {l.en.text}
                    </div>
                  )}
                </div>
              )
            }
            case 'bookTitle':
            case 'flashTitle':
            case 'openTitle': {
              const color =
                l.layer === 'bookTitle' ? text.bookTitleColor : l.layer === 'flashTitle' ? text.flashTitleColor : text.openTitleColor
              return (
                <div
                  key={l.layer}
                  data-testid={`layer-${l.layer}`}
                  {...selectable(l.layer)}
                  className="absolute whitespace-nowrap"
                  style={{
                    left: '50%',
                    top: l.top,
                    transform: 'translate(-50%, -50%)',
                    fontSize: l.fontSizePx,
                    color,
                    fontFamily: titleFamily,
                    ...textStroke,
                  }}
                >
                  {l.text}
                </div>
              )
            }
            case 'flashAuthor': {
              return (
                <div
                  key="flashAuthor"
                  data-testid="layer-flashAuthor"
                  {...selectable('flashAuthor')}
                  className="absolute whitespace-nowrap"
                  style={{
                    left: '50%',
                    top: l.top,
                    transform: 'translate(-50%, -50%)',
                    fontSize: l.fontSizePx,
                    color: text.flashAuthorColor,
                    fontFamily: titleFamily,
                    ...textStroke,
                  }}
                >
                  {l.text}
                </div>
              )
            }
            case 'watermark': {
              // 右上角，固定小字号、半透明，不参与图层选中
              return (
                <div
                  key="watermark"
                  data-testid="layer-watermark"
                  className="absolute whitespace-nowrap text-white"
                  style={{ top: l.top, right: l.right, fontSize: l.fontSizePx, opacity: l.opacity }}
                >
                  {l.text}
                </div>
              )
            }
            }
          })}
        </div>
      </div>
      <div className="mt-1 text-right">
        <span className="text-[10px] text-ink3">示意预览，最终以成片为准</span>
      </div>
    </div>
  )
}
