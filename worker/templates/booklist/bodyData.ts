// 一条片子的渲染输入契约。
//
// 这份类型原先长在 indexHtml.ts（浏览器渲染器的编排器）里。渲染改成纯 ffmpeg 后
// 那个文件整个删掉了，但契约本身不属于任何一个渲染器 —— 上游 renderVisuals 组装它、
// 下游 fromBodyData 消费它，所以单独成文件。

export interface BodyOverlay {
  title: string
  subtitle: string
  watermark: string
}

export interface BodyImage {
  src: string
}

export interface BodySegment {
  seqNo: number
  startMs: number
  endMs: number
  subtitle: string
  imageIndex: number
  bookTitle?: string
  bookAuthor?: string
  subtitleEn?: string
  captionBeats?: { zh: string; en?: string; startMs: number; endMs: number }[]
}

/** 快闪书封卡：一本书一张 */
export interface FlashCover {
  title: string
  author?: string
  coverSrc: string
}

export interface BodyData {
  size: { width: number; height: number }
  overlay: BodyOverlay
  images: BodyImage[]
  segments: BodySegment[]
  /** 框架指定的风格预设 id（framework.overlayTemplate.__style），缺省则由 seed 派生 */
  style?: string
  /** 稳定 seed（genTaskId），驱动预设/招式轮换的确定性 */
  seed?: string
  /** 模板模式：flash=碎裂开场+书单快闪+叠化正片；缺省/classic=既有编排不变 */
  template?: 'classic' | 'flash'
  /**
   * 开场碎裂那张图（相对 hf 目录）。
   * 缺省时渲染层回退正片第 1 张——老框架/未配置开场图时零回归。
   */
  openImage?: BodyImage
  templateParams?: import('./templateParams.js').TemplateParams
  flashCovers?: FlashCover[]
  fonts?: { family: string; url: string }[]
}
