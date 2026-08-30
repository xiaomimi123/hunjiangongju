// 正片成片尺寸 —— 唯一真源。
//
// worker 渲染（renderVisuals.ts / renderVideo.ts 的尺寸断言）与后台剪辑参数画布
// （web/components/admin/StageCanvas.tsx）必须用同一份数字，否则画布上文字相对
// 画面高度的占比会算错——运营看到的字号比成片里的小/大，照着画布调出来的参数
// 到成片上就偏了。之前两边各写一份字面量（worker 是 720x960，画布曾误写成
// 720x1280），这块画布的全部价值就是「画布上的数字与成片一致」，尺寸都能错说明
// 必须抽公共常量，不能再各存一份。
//
// ★ 改这个值等于改成片分辨率：renderVisuals.ts / renderVideo.ts 里都有尺寸断言
//（'body.mp4 尺寸异常' / 'final.mp4 尺寸异常'），改错了这里两边渲染都会直接报错
// 而不是悄悄出一个尺寸不对的成片。
export const BODY_SIZE = { width: 720, height: 960 } as const

// 快闪作者字号相对快闪书名字号的比例 —— worker（fromBodyData.ts 的
// `FS.flashAuthorRatio`）与后台剪辑画布（web/components/admin/stageGeometry.ts
// 的 flashAuthorFontSizePx）曾经各存一份 0.48 的字面量拷贝，且没有任何断言兜底：
// 改了一处忘了另一处，画布上算出的快闪作者字号会悄悄偏离成片，且没有任何报错。
// 与 BODY_SIZE 同一个道理——凡是「两边必须一致否则静默漂」的数字，都收进这个
// 叶子模块，两边各自 import，不再各写一份。
export const FLASH_AUTHOR_RATIO = 0.48
