# 开源项目 book-video 拆解 + 与我们的差距清单

> 目的：参考视频（听页/书评分享《活下去的理由》，720×960/25s，油画风，音轨=人声口播+BGM）效果比我们好。拆解开源项目 [Endless1936/book-video](https://github.com/Endless1936/book-video)（Apache-2.0），罗列它的"效果配方"，对照我们缺什么。

## 一、结论先行：我们差在哪
用户点名两条 + 拆解补充：
1. **没配 BGM**（其实混音代码有，只是渲染时没自动选曲）——最易补。
2. **没有剪辑特效**——模板只有 Ken-Burns 缓推+交叉淡化，缺开场/转场/结尾特效。
3. 配音是 TTS/克隆，它是**人声**（剪映导出），更自然。

## 二、book-video 的效果配方（视觉基线，来自 AGENTS.md）
它规定成片必须包含这套「视觉基线」（只用 `templates/shared-video-template/`）：
1. **玻璃碎片拼接开场** —— 模板内置 GSAP 动画（signature 开场特效）
2. **滚动书单** —— 6 本固定书滚动展示（`templates/shared-video-template/intro/default-book-list.json`）
3. **稳定标题/作者头** —— 常驻《书名》+作者（**我们 M2 已有**）
4. **氛围优先正文** + **缓慢推进(Ken-Burns)** + **交叉淡化** —— **我们已有**
5. **短黑场过渡** —— 段间短黑场（我们是 crossfade）
6. **结果页定格** —— 结尾"结果桥接图"定格
7. **黑影白字字幕**（德意黑/DIN 风格白字+纯黑阴影，无卡片/承托层）—— **我们已有**（且多了中英双语）
- 硬约束：画面必须 AI 生成位图；禁卡片UI/水印/复制帧/书封模型；<60s。

## 三、音频配方
- **片头口播 + 齿轮 SFX**（模板媒体，intro clip + gear 音效）—— 我们**无**
- **正文口播**从"正式介绍书籍"处开始 —— 人声（剪映导出 MP3）
- **BGM**：无指定时从曲库**随机选一首**，**裁剪到视频长度**再混音 —— 我们混音代码有、但不自动选曲
- 预设 `story`（故事感旁白处理）

## 四、生成流水线（scripts/*.mjs）
1. `node scripts/init.mjs` —— 环境检查（HyperFrames/imagegen、Node、FFmpeg、**whisper-cli 本地 ASR** + Whisper 模型）
2. 选书：`data/book-pipeline.csv` 候选池 + **微信读书 Skill** 取书详情/评分/划线/书评
3. `node scripts/validate-script.mjs "<book>"` → `script.csv`（字幕真源，首行《书名》，正文≤21行≈220字，总≤22行）
4. `node scripts/create-body-timings.mjs` → `body-timings.json`（**Whisper 本地 ASR** 对齐，语音停顿为主，`--skip-leading`）
5. AI 生图：2-3 张氛围图 + 1 张结果桥接图，记录 `prompts.csv`
6. 音频混音：intro + 齿轮SFX + 正文人声 + BGM（裁剪到长）
7. 渲染：HyperFrames + GSAP，720×960/30fps
8. `npm run check` 终检

**技术栈**：Node ESM、HyperFrames、GSAP、**Whisper 本地 ASR（whisper-cli）**、FFmpeg、Codex agentic（AGENTS.md 即"skill"规则）。

## 五、文案原则（它写得比我们细，值得抄）
- 开篇**直击情绪**，勿先介绍书
- 短句、口语化、具体场景
- **避免**"你是不是"式营销、"不是…而是"排比、机械排比
- 结尾留余味，**禁 CTA**（购物车/推荐语）
- 画面氛围优先，不逐句解释

## 六、逐项对比

| 维度 | book-video | 我们 | 差距 |
|---|---|---|---|
| BGM 混音 | 随机选+裁剪+压低混音 | 混音代码✅但**不自动选曲**（bgmId 多为空）、曲库仅1首 | 🔧 小补 |
| 玻璃碎片开场 | 模板 GSAP 内置 | 无（仅淡入） | ❌ 缺 |
| 滚动书单 intro | 6本滚动 | 无 | ❌ 缺 |
| 齿轮SFX/片头 | 有 | 无 | ❌ 缺 |
| 短黑场过渡 | 有 | crossfade | ⚠️ 不同 |
| 结果定格结尾 | 有 | 无 | ❌ 缺 |
| 配音 | 人声(剪映) | TTS/克隆音色 | ⚠️ 我们有克隆,可继续 |
| Ken-Burns+交叉淡化 | ✅ | ✅ | 同 |
| 标题/作者头 | ✅ | ✅(M2) | 同 |
| 黑影白字字幕 | ✅德意黑 | ✅中英双语 | 同(我们多英文) |
| 字数≤21行~220字 | ✅ | ✅ | 同 |
| ASR对齐 body-timings | Whisper本地 | 百炼ASR/bodyTimings | 同思路 |
| 文案原则 | 细(禁CTA/禁营销腔) | prompt较粗 | ⚠️ 可强化 |

## 七、补齐建议（按性价比排序）
1. **BGM 自动选曲**（最高性价比）：创建渲染任务时若无 bgmId → 从曲库随机选一首；扩充曲库到 4-5 首。混音代码已就绪（voice 1.0 / bgm 0.32 / loudnorm）。
2. **玻璃碎片开场 + 滚动书单 intro**：给 booklist 模板加 GSAP 开场动画（碎片拼合）+ 一个"本期书单"滚动段。这是最明显的"剪辑特效"。
3. **齿轮 SFX / 片头音效**：intro 段配一个音效，混入音频。
4. **结果定格结尾**：末尾加一张"结果/金句"定格页。
5. **短黑场过渡**（可选）：段间可选短黑场替代/叠加 crossfade。
6. **文案原则强化**：把它的口语化/禁CTA/禁营销腔规则写进 generateScript 的 prompt。

> 注：它用**人声(剪映)** + **Whisper 本地ASR**；我们用**克隆音色 TTS** + 百炼 ASR。方向不同但都能出片；我们的克隆音色是优势，不必改。
