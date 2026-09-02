# 学员端移动版改版 + 后台瘦身 + 扣子字段探测 设计

日期：2026-09-03 ｜ 状态：已经用户过目两轮 HTML 样稿定稿（scratchpad/mobile-mockup.html、video-card-mockup.html）

## 目标

1. 学员端按移动端优先重排：深色头部 + 公告轮播 + 工具宫格 + 视频卡片，五格底部导航（中央凸起「做片」）。
2. 全站视频展示统一为 VideoCard 卡片（学员首页/成片库/工具结果/后台生成列表）。
3. 后台导航下掉「视频拆解」「书库」入口（仅隐藏，页面与接口保留）。
4. 扣子工具后台「自动探测参数」：用流式接口空跑试探出必填字段名与文件类型。
5. 工具表单防错：必填星标、说明文案、错误定位到具体输入框。

## 非目标

- 不动渲染链路、不动积分扣退逻辑、不动登录体系。
- 不删除任何页面代码或数据表（extract/books 仅从导航消失）。
- 桌面端后台除生成列表与导航外不重排。

## 设计要点（均已样稿确认）

### 学员端信息架构
- 底部导航 5 格：首页 `/` · 框架 `/templates` · 做片（中央红色凸起圆钮，跳 `/templates`）· 工具 `/tools` · 我的 `/me`。
- 首页从上到下：深色头部（品牌 + 金色剩余积分）→ Banner 轮播 → 双 CTA（挑框架做视频 / 智能工具）→ 工具宫格 → 最近成片横滑。
- 工具宫格 2×4：只放已上架工具（名称首字作衬线大字图标 + 名称 + N 积分）；空位补「敬请期待」灰色占位格不可点；一个工具都没有时整块显示占位文案「更多工具开发中」。
- 成片库：筛选 chips（全部/书单成片/工具产出）+ 双列 VideoCard；工具产出里 kind=video 的项并入。
- 深色只用于首页头部；其余页面浅色白卡。图标一律线性 SVG，禁 emoji。

### VideoCard（共享组件）
- 9:16 海报位：`<video preload="metadata">` 取首帧当封面；状态角标（ok 绿/run 红/bad 深红）；时长角标；底部标题 + 副信息行。
- 点击行为由调用方定（内嵌播放 / 跳详情）。后台版底部多一排操作按钮。

### Banner 轮播
- 新表 `Banner`：`id, title, body, linkUrl?, enabled, sortOrder, createdAt`。纯文字样式（深红渐变底），不做图片上传。
- 后台「运营」组新增「公告 Banner」页：增删改、排序、启停。
- 学员端 `GET /api/banners` 只返回 enabled 按 sortOrder；前端 5 秒自动轮播 + 圆点。

### 扣子自动探测
- `POST /api/admin/coze-tools/fetch-params` 保留；新增 `POST /api/admin/coze-tools/probe-params`（body `{workflowId}`）。
- 服务端循环（上限 12 轮）调 `/v1/workflow/stream_run`：`Missing parameter: X` → 记必填字段；`can't convert to file` → 该字段标 image；无错误事件/跑起来 → 收敛。返回 `[{name, type: 'text'|'image', required: true}]`。
- 探通的最后一轮会真的启动一次工作流：探测成功响应里带 `warning` 字段提示运营（不算学员积分，扣子侧消耗一次运行）。
- 管理页「自动探测」按钮把结果合并进输入项编辑器（同名不覆盖已配置项），运营补中文标签。

### 后台生成列表
- 行表改卡片网格（VideoCard + 学员归属 + 操作按钮工作台/下载/重跑），状态筛选 chips 保留。

## 验收

- 现有 1348 条测试全绿；新功能各带测试。
- 学员端在 iPhone 尺寸（390 宽）无横向滚动、底导航不遮内容。
- 旧路由 /admin/extract、/admin/books 直接访问仍可用。
