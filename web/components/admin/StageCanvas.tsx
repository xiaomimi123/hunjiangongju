'use client'
// 剪辑参数的所见即所得画布。
//
// ★ 它是**模拟器不是渲染器**。真正出片的是 worker 的 ass.ts + libass。
// 保真靠三条，缺一条这块画布就会开始骗人：
//   1. 坐标 1:1 零换算 —— 缩放只发生在最外层 transform: scale()，
//      内部一律用真实像素（720×960（真实值见 packages/db 的 BODY_SIZE）这一类）。画布上的每个数字**就是**存进参数的数字。
//      全部几何计算（top / 字号 / 是否显示）都在 stageGeometry.ts 里算好，
//      本文件只负责把算好的数字渲染成绝对定位的 div，不再做任何计算。
//   2. 共享 fitSizePx —— 长书名的缩排走 packages/db 里的那一份，与成片同一个函数
//      （stageGeometry.ts 里 import，这里不重复引用）。
//   3. 同一份字体二进制 —— 通过 GET /api/fonts/<id>/file 拿，就是 worker 渲染时
//      fontsdir 里的那个文件，用 FontFace API 动态注册后渲染。
// 仍然存在的差异：字距、CJK 断行位置、描边叠加顺序。所以画布角上常驻
// 「示意预览，最终以成片为准」。
//
// Task 19 做了静态渲染；本文件（Task 20）在此基础上加拖拽交互：
//   - 纵向拖动图层改 posY，拖图层正下方的把手改字号 —— 换算全部是纯函数
//     （stageGeometry.ts 的 nextPosY / nextCaptionSizePx / nextLayerScale），
//     本文件只负责事件接线（onPointerDown + window 上的 pointermove/pointerup），
//     不含任何算术，保证换算逻辑能在 node 环境用 vitest 测到。
//   - 用 Pointer Events，不用 HTML5 drag：drag 在有 `transform: scale` 的
//     容器里坐标会错位。
//   - 只读 clientY，完全不读 clientX——ass.ts 里所有文字层都是居中锚定
//     （an2 / an5 + \pos(cx, y)），横向坐标从不参与渲染，给横向拖拽自由度
//     只会让运营以为拖了、成片却纹丝不动。
// 已接入两个 studio 页（web/app/admin/generate/[id]/studio、
// web/app/admin/frameworks/[id]/studio），不是"下一个任务"了——本文件上一版
// 注释在这块留过一句过期的"仍不接入"，被审阅点名（这个项目已经被错注释坑过
// 两次，错注释比没注释更危险），这里改成准确说法。

import { useEffect, useRef, useState } from 'react'
// 子模块路径导入（非 '@mixcut/db' 包索引）：见 stageGeometry.ts 顶部注释，走包索引会把
// Prisma/服务端代码带进客户端 bundle。本文件已经是 'use client'。
import { DEFAULT_FONT_ID } from '@mixcut/db/src/booklist/fonts'
import type { TextParams, FontOption } from './paramControls'
import {
  computeStageLayers,
  nextPosY,
  nextCaptionSizePx,
  nextLayerScale,
  type StageScene,
  type StageLayer,
  type StageSample,
} from './stageGeometry'

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

/**
 * 画布上给某个字体条目起的**别名**，与真实 family 名脱钩，按字体 id 拼出来。
 *
 * 为什么不能直接用真实 family：内置字体里 noto-sc（思源黑体 Regular，weight 400）
 * 与 noto-sc-bold（思源黑体 Bold，weight 700）**族名完全相同**，都是
 * 'Noto Sans SC'（见 packages/db/src/booklist/fonts.ts 的注释，这是字体格式
 * 本身的设计，不是撞名）。如果两个 FontFace 用同一个 family 注册进
 * document.fonts，最终哪个生效取决于两次异步 load() 谁先完成——非确定性：
 * 运营选思源黑体 Bold，画布可能显示 Regular；选 Regular 的框架也可能被后到的
 * Bold 面顶掉。按字体 id 起唯一别名注册，就让每个字体条目在画布上都是独立的
 * 一款，Regular 与 Bold 不再互相打架。
 */
function stageAlias(id: string): string {
  return `mixcut-${id}`
}

/** 画布上实际要用的 font-family：按字体 id 查，查不到回退 undefined（浏览器默认字体） */
function familyOf(fonts: FontOption[], id: string | undefined): string | undefined {
  if (!id) return undefined
  return fonts.find((f) => f.id === id) ? stageAlias(id) : undefined
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
  // 纵向拖动图层触发：v 是换算后的新 posY（0..1）。
  onPosY: (layer: StageLayer, v: number) => void
  // 拖图层下方把手触发：caption 层 v 是新的 captionSizePx（绝对像素），
  // 其余层 v 是新的 *Scale 倍数（相对 captionSizePx）。
  onSize: (layer: StageLayer, v: number) => void
}) {
  const { width, height, text, captionColor, captionPosY, fonts, scene, sample } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [fileBgUrl, setFileBgUrl] = useState<string | null>(null)
  // 组件卸载时也要 revoke 本地上传底图的 object URL——换图时已经在 onChange
  // 里 revoke 了上一张，但如果运营上传一张图后直接离开页面（没有再换一次图），
  // 那张就会一直漏在内存里没人 revoke。用 ref 存最新值，避免 effect 依赖
  // fileBgUrl 导致每次换图都重新挂一次 unmount 监听。
  const fileBgUrlRef = useRef<string | null>(null)
  fileBgUrlRef.current = fileBgUrl
  useEffect(() => {
    return () => {
      if (fileBgUrlRef.current) URL.revokeObjectURL(fileBgUrlRef.current)
    }
  }, [])

  // 坐标 1:1：缩放只发生在这一层，内部 children 全部用真实像素定位。
  //
  // scale 封顶不放大（Math.min(1, ...)）：容器越宽（大屏），按 containerW / width
  // 算出的 scale 会大于 1，把 720 宽的真实画面撑大显示——线上实测撑到 1.6 倍后
  // 单帧要滚 2.5 屏才能看完，而「一眼看清整帧构图」正是这块画布存在的意义。
  // 同时按可用视口高度再收一档（availH / height）：这块画布常年 sticky 贴顶，
  // 高度超出视口一样滚不完整帧，宽度封顶不放大解决不了这个问题。
  // 两个上限取更小的那个，且都不超过 1——不满足其中任一条都不放大画布。
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const update = () => {
      if (box.clientWidth <= 0) { setScale(1); return }
      const byWidth = box.clientWidth / width
      const availH = Math.max(240, window.innerHeight - 160)
      const byHeight = availH / height
      setScale(Math.min(1, byWidth, byHeight))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(box)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [width, height])

  // 同一份字体二进制：与 worker fontsdir 里的文件一致，动态注册后渲染。
  //
  // 按 stageAlias(f.id) 注册，不用 f.family：见 stageAlias 注释——内置的
  // noto-sc / noto-sc-bold 族名相同，直接用 family 注册会导致两个 FontFace
  // 用相同 (family, weight, style) 竞争 document.fonts，谁生效由异步 load()
  // 的完成顺序决定，非确定性。别名与 familyOf() 的取名逻辑必须保持一致。
  //
  // ★ 按需加载，不是一进页面就把内置库全拉一遍：内置 5 款合计约 54MB
  // （霞鹜文楷单个 24.7MB），线上从服务器传到浏览器很慢，全量预加载会让运营
  // 在字体真正可用之前有很长一段"点了没反应"的空窗。这里只加载当前三个字体槽
  // （正文字幕 / 标题类 / 英文行）实际引用到的字体 id——槽位留空表示"跟随"
  // （标题/英文跟正文，正文留空则跟内置默认 DEFAULT_FONT_ID），不产生独立请求。
  // loadedIdsRef 记录"已经发起过加载"的 id，避免同一个 id 被换字体来回切换
  // 时重复 new FontFace + document.fonts.add。
  //
  // ★ 特意不用「cancelled 标志位 + effect 清理函数」去挡卸载后的 setState——
  // 这块画布常年挂载在 studio 页里不会真被卸载，而 React 18 开发环境的
  // StrictMode 会挂载两次来暴露副作用问题：cancelled 标志位会在第一次挂载的
  // 清理阶段就被置真，导致第一次挂载发起的 load() 永远无法把状态写回去；
  // 而 loadedIdsRef 又已经记下这个 id，第二次挂载看到"已发起过"就直接跳过、
  // 不再重新发起——两边一凑，字体状态卡死在"加载中"，界面上比原来的
  // bug（一进页面全量下载 54MB）还隐蔽。document.fonts.add() 与
  // setFontStatus() 在组件真的卸载后调用都是安全的空操作，不需要挡。
  const loadedIdsRef = useRef<Set<string>>(new Set())
  const [fontStatus, setFontStatus] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({})
  useEffect(() => {
    const neededIds = new Set<string>()
    neededIds.add(text.captionFontId || DEFAULT_FONT_ID)
    if (text.titleFontId) neededIds.add(text.titleFontId)
    if (text.enFontId) neededIds.add(text.enFontId)

    for (const id of Array.from(neededIds)) {
      if (loadedIdsRef.current.has(id)) continue
      const entry = fonts.find((f) => f.id === id)
      if (!entry) continue
      loadedIdsRef.current.add(id)
      setFontStatus((s) => ({ ...s, [id]: 'loading' }))
      const face = new FontFace(stageAlias(id), `url(/api/fonts/${id}/file)`)
      face
        .load()
        .then((loaded) => {
          document.fonts.add(loaded)
          setFontStatus((s) => ({ ...s, [id]: 'loaded' }))
        })
        .catch(() => {
          // 加载失败就回退浏览器默认字体——不能让一个字体坏掉整块画布，
          // 但状态要显式标成 error，不能和 loading 长一个样（那正是本次要修的坑）。
          loadedIdsRef.current.delete(id) // 允许换个字体或重试时再次触发加载
          setFontStatus((s) => ({ ...s, [id]: 'error' }))
        })
    }
  }, [fonts, text.captionFontId, text.titleFontId, text.enFontId])

  const pendingFontIds = Object.entries(fontStatus)
    .filter(([, st]) => st === 'loading')
    .map(([id]) => id)
  const failedFontIds = Object.entries(fontStatus)
    .filter(([, st]) => st === 'error')
    .map(([id]) => id)
  const fontLabel = (id: string) => fonts.find((f) => f.id === id)?.label ?? id

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

  // 拖拽期间正在处理的 pointerup 清理函数（组件卸载时也要清，避免泄漏 window 监听器）。
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    return () => dragCleanupRef.current?.()
  }, [])

  /**
   * 各图层当前的 posY（0..1），拖拽起点。
   * flashAuthor / watermark 没有独立的 posY 参数，返回 undefined，不支持位置拖拽：
   *   - flashAuthor 的位置完全由 flashTitle 的 top + 固定偏移派生
   *     （见 stageGeometry.ts flashAuthorTop），`TextParams` 里没有
   *     `flashAuthorPosY` 这个字段——给它挂拖拽会是纯粹的空操作：运营拖了、
   *     看着动了，松手后其实什么都没存进参数，成片不会变。这种「拖了没反应」
   *     比「不能拖」更糟，所以 flashAuthor 在下方 JSX 里不挂 selectable /
   *     onPointerDown，只展示、不可选、不可拖。
   *   - watermark 固定右上角。
   */
  const posYOf = (layer: StageLayer): number | undefined => {
    switch (layer) {
      case 'caption':
        return captionPosY
      case 'bookTitle':
        return text.bookTitlePosY
      case 'flashTitle':
        return text.flashTitlePosY
      case 'openTitle':
        return text.openTitlePosY
      default:
        return undefined
    }
  }

  /**
   * 拖字号把手的起始值。caption 是绝对像素（captionSizePx），
   * 其余层是各自的 *Scale 倍数。
   * flashAuthor / watermark 没有独立的字号参数，返回 undefined，不提供把手：
   *   - flashAuthor 的字号由 `captionSizePx * flashTitleScale * 0.48`
   *     （fromBodyData.ts 的 FS.flashAuthorRatio）派生，见 stageGeometry.ts
   *     flashAuthorFontSizePx；`TextParams` / paramsWhitelist.ts 里它只有
   *     `flashAuthorColor`，没有独立的 posY 或 scale 字段可写回。
   *     ★ 曾经让它的把手复用 flashTitleScale——但那样拖它会连带把快闪书名
   *     一起改大改小，运营根本想不到；给一个「拖了却改到别的东西」的控件
   *     比不给控件更糟，所以改成不可选、不可拖（见下方 JSX，flashAuthor
   *     分支不再挂 selectable / onPointerDown / 把手）。将来如果给它补了
   *     独立参数，再放开这条分支即可。
   *   - watermark 固定字号，不支持拖拽。
   */
  const sizeStartOf = (layer: StageLayer): number | undefined => {
    switch (layer) {
      case 'caption':
        return text.captionSizePx
      case 'bookTitle':
        return text.bookTitleScale
      case 'flashTitle':
        return text.flashTitleScale
      case 'openTitle':
        return text.openTitleScale
      default:
        return undefined
    }
  }

  const setBodyDragCursor = (on: boolean) => {
    document.body.style.cursor = on ? 'ns-resize' : ''
    document.body.style.userSelect = on ? 'none' : ''
  }

  /**
   * 纵向拖动图层改 posY。只读 e.clientY，完全不读 e.clientX——ass.ts 里所有
   * 文字层都是居中锚定（an2/an5 + \pos(cx, y)），给水平自由度等于骗人：
   * 运营横着拖了、成片却纹丝不动。
   */
  const beginPosDrag = (layer: StageLayer, e: React.PointerEvent) => {
    const startPosY = posYOf(layer)
    if (startPosY === undefined) return
    e.stopPropagation()
    const startClientY = e.clientY
    setBodyDragCursor(true)
    const onMove = (ev: PointerEvent) => {
      props.onPosY(layer, nextPosY(startPosY, ev.clientY - startClientY, scale, height))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setBodyDragCursor(false)
      dragCleanupRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    dragCleanupRef.current = onUp
  }

  /** 拖图层下方把手改字号。同样只读 e.clientY。 */
  const beginSizeDrag = (layer: StageLayer, e: React.PointerEvent) => {
    const startValue = sizeStartOf(layer)
    if (startValue === undefined) return
    e.stopPropagation()
    const startClientY = e.clientY
    setBodyDragCursor(true)
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startClientY
      const v =
        layer === 'caption' ? nextCaptionSizePx(startValue, dy, scale) : nextLayerScale(startValue, dy, scale, text.captionSizePx)
      props.onSize(layer, v)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setBodyDragCursor(false)
      dragCleanupRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    dragCleanupRef.current = onUp
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

      {/* 字体加载状态：加载中 / 失败必须显式区分，不能和"没反应"长一个样——
          这正是本次要修的体验坑（用户反馈"点击之后没有变化"，其实是内置字体
          单款最大 24.7MB，还在下载）。成功不额外展示，避免常驻噪音。 */}
      {(pendingFontIds.length > 0 || failedFontIds.length > 0) && (
        <div className="mb-2 space-y-1" data-testid="stage-font-status">
          {pendingFontIds.length > 0 && (
            <p className="text-xs text-ink3" data-testid="stage-font-loading">
              字体加载中…（{pendingFontIds.map(fontLabel).join('、')}）
            </p>
          )}
          {failedFontIds.length > 0 && (
            <p className="text-xs text-red-500" data-testid="stage-font-error">
              字体加载失败，预览用系统字体代替（{failedFontIds.map(fontLabel).join('、')}）
            </p>
          )}
        </div>
      )}

      {/* 外层 boxRef：全宽测量容器，ResizeObserver 挂在它身上算 scale——
          它的宽度必须只由父级布局决定，不能反过来被 scale 影响，否则「按容器宽度算
          scale、再按 scale 设容器宽度」会互相依赖。真正裹住画面的是内层这个显式
          width/height = 真实像素 * scale 的方框，用 mx-auto 在可用宽度里居中，
          边框才会刚好贴着画面，不再留一截空白。 */}
      <div ref={boxRef} className="w-full">
        <div
          className="relative mx-auto overflow-hidden rounded border border-line"
          style={{ width: width * scale, height: height * scale }}
        >
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
                <div key="caption" data-testid="layer-caption" onPointerDown={(e) => beginPosDrag('caption', e)}>
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
                  {props.selected === 'caption' && (
                    <div
                      data-testid="handle-caption"
                      onPointerDown={(e) => beginSizeDrag('caption', e)}
                      className="absolute"
                      style={{
                        left: '50%',
                        top: l.zh.top + 4,
                        width: 120,
                        height: 8,
                        transform: 'translate(-50%, 0)',
                        cursor: 'ns-resize',
                        background: 'rgba(255, 138, 61, 0.85)',
                        borderRadius: 4,
                      }}
                    />
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
                <div key={l.layer}>
                  <div
                    data-testid={`layer-${l.layer}`}
                    {...selectable(l.layer)}
                    onPointerDown={(e) => beginPosDrag(l.layer, e)}
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
                  {props.selected === l.layer && (
                    <div
                      data-testid={`handle-${l.layer}`}
                      onPointerDown={(e) => beginSizeDrag(l.layer, e)}
                      className="absolute"
                      style={{
                        left: '50%',
                        top: l.top + l.fontSizePx / 2 + 4,
                        width: 120,
                        height: 8,
                        transform: 'translate(-50%, 0)',
                        cursor: 'ns-resize',
                        background: 'rgba(255, 138, 61, 0.85)',
                        borderRadius: 4,
                      }}
                    />
                  )}
                </div>
              )
            }
            case 'flashAuthor': {
              // ★ 只展示，不可选、不可拖：TextParams / paramsWhitelist.ts 里 flashAuthor
              // 只有 flashAuthorColor，没有独立的 posY / scale 字段——它的位置跟随
              // flashTitle 下方固定偏移、字号是 flashTitleScale 的 0.48 倍（见
              // stageGeometry.ts 的 flashAuthorTop / flashAuthorFontSizePx）。
              // 给它做可拖控件等于骗运营：要么拖了没反应，要么拖了却改到 flashTitle
              // 头上，两种都比不给控件更糟。不挂 selectable，不设 cursor，保持默认光标。
              return (
                <div
                  key="flashAuthor"
                  data-testid="layer-flashAuthor"
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
      </div>
      <div className="mt-1 flex items-center justify-between">
        {scene === 'flash' && (
          <span className="text-[10px] text-ink3" data-testid="flash-author-hint">
            作者行的位置与大小跟随快闪书名（位置在其下方、字号为其 0.48 倍），没有独立参数，画布上不可单独拖动
          </span>
        )}
        <span className="ml-auto text-[10px] text-ink3">示意预览，最终以成片为准</span>
      </div>
    </div>
  )
}
