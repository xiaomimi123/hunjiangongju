import { pickSubset } from '@mixcut/db'

// 配图不再跟着文案走。
//
// 旧做法是让 LLM 把每段口播提炼成一句画面描述再去生图，结果必然是逐句配插画——
// 「手还能端起自己的碗」画一只碗、「台阶看不见」画石阶、「文字长出翅膀」画羽毛。
// 换画风只会得到「梵高风格的碗」，主体依旧被文案锁死。
//
// 现在改成自由创作：主体不来自文案，只给一个场景方向 + 框架的画风提示词。
// 之所以还要「场景方向」而不是六段发同一句提示词——同提示词会让生图模型产出六张
// 近乎雷同的画。方向由 genTaskId 派生的确定性随机源分配：同任务重跑结果一致，
// 不同任务必然不同（本仓禁用 Math.random）。
export const ART_SCENES = [
  '星空下的夜色',
  '风吹过的麦田',
  // 原本写的是「夜晚亮着灯的街边咖啡馆」，评审指出它与「无人物」约束天然打架——
  // 梵高《夜间露天咖啡座》原作坐满了人，这个方向会诱导模型画人物。改成只取其配色与
  // 光感（暖黄灯光 × 蓝紫夜色），不带任何会引出人的场所语义。
  '深夜街角的暖黄灯光与蓝紫夜色',
  '盛开的鸢尾花丛',
  '柏树与旋转的云',
  '向日葵田',
  '河畔与小桥',
  '春天开花的果园',
  '黄昏的山丘与田垄',
  '雨后的小镇屋顶',
  '海边的礁石与浪',
  '晨雾中的树林',
  '收割后的田野与草垛',
  '夜色中的运河与倒影',
  '开阔的原野与流云',
  '月光下的花园小径',
]

/**
 * 纯函数：按 seed 给 n 个分镜各派一个场景方向。
 * 先整池洗牌再按下标取，因此分镜数不超过池子大小时互不重复；超出则循环复用
 * （仍是洗牌后的顺序，不会紧挨着重复同一个）。
 */
export function pickArtScenes(seed: string, n: number): string[] {
  if (n <= 0) return []
  const shuffled = pickSubset(ART_SCENES, ART_SCENES.length, seed)
  return Array.from({ length: n }, (_, i) => shuffled[i % shuffled.length])
}

/**
 * 纯函数：拼单张配图的提示词。
 * 禁文字约束在此保底——文案绝不能被画进图里，否则会和字幕层叠字、糊成乱码。
 */
export function buildFreeArtPrompt(stylePrompt: string, scene: string): string {
  return [stylePrompt, scene, '竖屏背景，纯画面，不出现任何文字、字幕或水印']
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join('，')
}
