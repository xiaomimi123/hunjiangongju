# 投流素材混剪工具 MVP —— 设计文档

日期：2026-07-09
上游文档：《投流素材混剪工具_MVP开发文档_v1.0.md》（简称"开发文档"）、《电商带货混剪视频生成工具_MVP项目方案书.docx》

本设计文档不重复开发文档内容。**架构、状态机、数据库 schema、API 清单、页面清单、质检规则、分期计划均以开发文档为准**；本文档记录开发文档之外经用户确认的补充决策与工程方案。

## 1. 新增需求（用户确认）

1. **先本地 Docker 部署测试跑通，再上传服务器**。本地与服务器使用同一份 `docker-compose.yml`，仅以 `.env` 区分环境。
2. **Web 端移动端适配：学员端与运营后台两端均为移动端优先设计**（主要用户通过手机访问）。
3. **成片输出规格：竖屏 9:16（1080×1920）与横屏 16:9（1920×1080）都支持，学员建任务时选择**。

## 2. 工程结构（方案 A，已确认）

npm workspaces 单仓库：

```
电商带货混剪工具/
├── docker-compose.yml           # web + worker + postgres + redis 四服务
├── docker-compose.dev.yml       # 本地开发覆盖（代码卷挂载 + 热更新）
├── .env.example
├── package.json                 # workspaces: ["web", "worker", "packages/db"]
├── packages/db/                 # Prisma schema + client，web 与 worker 共享
├── web/                         # Next.js 14 App Router + TypeScript + Tailwind CSS
│   └── app/
│       ├── (student)/           # /login、/（首页）、/works、/works/[id]
│       ├── admin/               # /admin/tags、/admin/materials、/admin/scripts、/admin/tasks、/admin/tasks/[id]
│       └── api/                 # 开发文档第 5 节的全部 API Routes
├── worker/                      # Node 独立进程 + BullMQ + fluent-ffmpeg
│   └── jobs/                    # segment-script、match-materials、render-draft、run-qc
└── data/                        # 挂载卷：materials/、exports/（git 忽略）
```

- 四个 BullMQ job、状态机流转、质检三项检测全部按开发文档第 3、5、7 节实现。
- nginx 容器 MVP 本地阶段不启用（Next.js 直接出 3000 端口），上服务器时按需加。

## 3. 补充设计决策（开发文档未覆盖，已确认）

| # | 事项 | 决策 |
|---|---|---|
| 1 | 文案发布状态 | `scripts` 表加 `status VARCHAR(16) DEFAULT 'draft'`（draft / published）。学员端首页只展示 published 文案；运营在 `/admin/scripts` 切换发布状态 |
| 2 | 输出规格 | `tasks` 表加 `aspect_ratio VARCHAR(8) DEFAULT '9:16'`（'9:16' / '16:9'）。建任务时选择。素材宽高比与目标不一致时，统一"等比缩放适配 + 高斯模糊背景垫底"，不裁切画面内容 |
| 3 | 字幕实现 | 渲染时按分镜时间轴生成 SRT 文件 → FFmpeg `subtitles` filter（libass）烧录；同一份 SRT 直接作为导出产物之一，单一数据源 |
| 4 | 移动端交互 | Tailwind 移动优先断点。运营后台分镜编辑：卡片列表 + 底部抽屉（bottom sheet）选素材 + 上/下移按钮调顺序（不做拖拽）。标签树：可折叠层级列表。素材上传：原生 file input（手机直接调相册/相机），上传中显示进度 |
| 5 | 本地测试数据 | seed 脚本：预置运营/学员账号、开发文档第 4 节初始标签树、示例文案（含 published）；用 FFmpeg 生成约 12 条带颜色/文字标识与音频的测试素材（横竖屏混合），本地零依赖跑通全闭环 |
| 6 | 认证 | JWT 存 httpOnly cookie（非 localStorage）。密钥登录同样换发 JWT cookie。middleware 按 role 保护 `/admin` 路由 |
| 7 | 字幕越界质检阈值 | 按"字符数 ÷ 分镜时长"估算语速，中文超过约 6 字/秒判 fail（实现时定为常量，可配置） |

## 4. 渲染管线细节

每个分镜段的 FFmpeg 处理（在 `render-draft` job 中）：

1. 按 `task_segments.start_ms/end_ms` 截取素材片段；`end_ms` 为空时按字幕文本估算时长（字符数 ÷ 语速常量）。
2. 统一到目标分辨率：等比缩放 + 模糊背景垫底（`split → scale+boxblur 背景 / scale 前景 → overlay`）。
3. 统一编码参数（H.264、yuv420p、30fps、AAC 音轨；素材无音轨时补静音轨，保证 concat 不失败）。
4. 各段落盘为中间片段后 concat，再用 `subtitles` filter 烧录 SRT，输出初稿 MP4 至 `data/exports/<taskId>/draft.mp4`。

质检（`run-qc` job）：`blackdetect`、`silencedetect`、字幕越界（决策 7），结果写 `qc_reports`，全 pass 进 `QC_PASSED`，任一 fail 打回 `REVISING`——均按开发文档第 7 节。

## 5. 本地 Docker 开发与验证流程

1. `docker compose up`（dev 覆盖文件启用热更新）→ 起 postgres、redis、web、worker。
2. `prisma migrate dev` + seed 脚本灌入测试数据。
3. 验证闭环（即验收标准）：
   - 运营登录 → 标签树/素材/文案管理各页面可用；
   - 学员登录 → 首页选 published 文案 → 选输出规格 → 建任务；
   - 任务自动走完 SEGMENTING → MATCHING → STORYBOARD_READY → RENDERING → PREVIEW_PENDING；
   - 人为制造素材不足场景，走 MATERIAL_PENDING → 运营补素材 → link-material → 回到 MATCHING；
   - 预览确认 → QC_RUNNING → QC_PASSED → EXPORTED，下载 MP4 + SRT + 项目 JSON；
   - 换素材/改字幕/调顺序的 revise 回路可用；
   - 全部关键页面在 375px 视口下检查布局与操作可用性。
4. 单元测试：自然段分段规则、标签重合度打分、字幕越界估算。
5. 跑通后：代码推服务器，同一 compose 文件 + 生产 `.env` 部署（服务器信息待用户后续提供）。

## 6. 范围边界

开发文档第 1 节"明确不做"与方案书第四节"本期不包含"清单全部维持不变。本文档新增内容仅限第 1、3 节所列各项。
