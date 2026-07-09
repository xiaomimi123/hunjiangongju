# 投流素材混剪工具 —— MVP 开发文档 v1.0

> 范围:客户需求中的"投流素材/多片混剪"模块(即客户流程图标注的"电商带货混剪视频核心业务流程")
> 明确不做:自然流模板、辅助剪辑高级自定义模式、AI文生视频/图生视频兜底、口型同步/数字人、学员token计费。这些留到 Phase 2+(见文末分期计划)。

---

## 1. MVP 目标

跑通一条完整闭环:**运营建素材库 + 文案 → 学员一键生成 → 自动分镜/渲染 → 自动质检 → 导出成片**。

MVP 阶段的核心简化原则:
- 能用规则解决的,不引入AI(分段、素材匹配都用规则/标签,不用向量检索或LLM)
- 素材不足时**人工补充**,不接AI生成(省GPU成本,也省开发时间)
- 视频只做"混剪+字幕",暂不做AI配音/口型同步
- 权限用简化的账号/密钥模式,不做复杂RBAC

---

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | Next.js 14 (App Router) + TypeScript + Tailwind CSS | 学员端 + 运营后台同一个项目,路由区分 |
| 后端API | Next.js API Routes | CRUD类接口 |
| 任务worker | Node.js 独立进程 + BullMQ | 长耗时渲染任务不能塞进API Route里跑 |
| 数据库 | PostgreSQL + Prisma ORM | schema即代码,方便迭代 |
| 队列/缓存 | Redis | BullMQ依赖 |
| 视频处理 | FFmpeg(fluent-ffmpeg 封装) | 拼接、烧字幕、黑屏/静音检测 |
| 对象存储 | MVP阶段:服务器本地磁盘挂载卷;跑通后迁移阿里云OSS/腾讯COS | 先跑通再优化 |
| 部署 | Docker Compose,单台云服务器 | 2核4G起步,渲染压力大再升配 |
| 鉴权 | JWT + 邀请码/密钥表 | 不接第三方OAuth |

---

## 3. 核心处理管线(状态机)

```
CREATED
  → SEGMENTING          (脚本自动分段:按自然段拆分,即按文案原文的换行/空行切段,不做智能语义分段)
  → MATCHING            (按标签树匹配素材库:分镜段标签与素材标签重合度打分,取最高分素材)
  → [素材是否充足?]
      不足 → MATERIAL_PENDING  (运营从任务详情页跳转素材库页面上传新素材并打标签,
                                 返回任务详情页手动将素材关联到对应分镜段,关联后回到 MATCHING)
      充足 → STORYBOARD_READY  (生成分镜与时间轴 JSON)
  → RENDERING           (FFmpeg拼接+烧字幕,生成初稿)
  → PREVIEW_PENDING     (学员/运营预览)
  → [是否需要修改?]
      需要 → REVISING → (换素材/改字幕/调顺序,人工在运营后台操作) → 回到 PREVIEW_PENDING
      不需要 → QC_RUNNING
  → QC_RUNNING          (自动质检:黑屏/静音/字幕越界)
  → [质检是否通过?]
      不通过 → QC_FAILED → 回到 REVISING
      通过 → QC_PASSED
  → EXPORTED            (导出 MP4 + 字幕文件 + 项目JSON)
```

用 `tasks.status` 存当前状态,`task_status_logs` 表记录每次流转,方便排查"卡在哪一步"。

---

## 4. 数据库设计

```sql
-- 用户(学员/运营,用 role 区分)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'student', -- student | operator
  created_at TIMESTAMP DEFAULT now()
);

-- 密钥模式访问控制(可选,与account二选一)
CREATE TABLE access_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_value VARCHAR(128) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id),
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

-- 文案库(公司提供)
CREATE TABLE scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- 文案分段结果
CREATE TABLE script_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID REFERENCES scripts(id),
  seq_no INT NOT NULL,
  text TEXT NOT NULL
);

-- 标签分类树(运营预设维护,不开放自由文本)
CREATE TABLE tag_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL,
  parent_id UUID REFERENCES tag_categories(id), -- NULL 为顶级分类
  sort_order INT DEFAULT 0
);

-- 素材库
CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_url VARCHAR(512) NOT NULL,
  thumbnail_url VARCHAR(512),
  duration_ms INT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- 素材 <-> 标签(多对多,一个素材可挂多个分类节点)
CREATE TABLE material_tags (
  material_id UUID REFERENCES materials(id),
  tag_id UUID REFERENCES tag_categories(id),
  PRIMARY KEY (material_id, tag_id)
);

-- 文案分段 <-> 标签(用于和素材标签做匹配)
CREATE TABLE segment_tags (
  segment_id UUID REFERENCES script_segments(id),
  tag_id UUID REFERENCES tag_categories(id),
  PRIMARY KEY (segment_id, tag_id)
);

-- 任务
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  script_id UUID REFERENCES scripts(id),
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 任务的分镜结果(每段用哪个素材)
CREATE TABLE task_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  segment_id UUID REFERENCES script_segments(id),
  material_id UUID REFERENCES materials(id),
  order_no INT NOT NULL,
  start_ms INT DEFAULT 0,
  end_ms INT,
  subtitle_text TEXT
);

-- 状态流转日志
CREATE TABLE task_status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  note TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- 质检报告
CREATE TABLE qc_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  check_type VARCHAR(32), -- black_frame | silence | subtitle_overflow
  result VARCHAR(16),     -- pass | fail
  detail TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- 导出产物
CREATE TABLE exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  video_url VARCHAR(512),
  subtitle_url VARCHAR(512),
  project_json_url VARCHAR(512),
  created_at TIMESTAMP DEFAULT now()
);
```

**标签分类树初始建议结构**(开工前和运营/客户过一遍,确认后再录入 `tag_categories`,后续可随时加节点):

```
场景
├── 书房/阅读角
├── 户外
└── 产品特写
人物
├── 讲解人出镜
└── 无人出镜
产品类型
├── 育儿类
├── 养生类
└── 小说类
情绪基调
├── 自然口播
└── 情绪煽动
```

---

## 5. API 接口清单

### 认证
- `POST /api/auth/login` —— 账号密码或密钥登录,返回JWT
- `POST /api/auth/register` —— 仅运营邀请开通(MVP不做自助注册)

### 标签分类树(运营端)
- `GET /api/tag-categories` —— 获取整棵树
- `POST /api/tag-categories` —— 新建分类节点(支持传 parent_id 挂到已有节点下)
- `PATCH /api/tag-categories/:id` —— 改名/调整排序/挂载到不同父节点
- `DELETE /api/tag-categories/:id` —— 删除节点(需校验无素材/分段仍在引用)

### 素材库(运营端)
- `POST /api/materials` —— 上传素材文件 + 关联 tag_ids(从分类树勾选,不接受自由文本)
- `GET /api/materials?tag_id=xxx` —— 按标签节点筛选
- `DELETE /api/materials/:id`

### 文案库(运营端)
- `POST /api/scripts` —— 新建文案
- `GET /api/scripts` —— 列表
- `POST /api/scripts/:id/segment` —— 触发自动分段(规则式:按自然段/换行空行切分,写入 script_segments)
- `PATCH /api/scripts/segments/:id/tags` —— 给分段勾选标签(从分类树选,用于后续匹配)

### 任务(学员端 + 运营端)
- `POST /api/tasks` —— 学员选定 script_id 发起任务(入队 segment-script job)
- `GET /api/tasks?status=xxx` —— 任务列表,支持状态筛选
- `GET /api/tasks/:id` —— 详情(含分镜、状态日志、质检报告)
- `POST /api/tasks/:id/segments/:segmentId/link-material` —— 运营在素材库上传新素材后,回到任务详情页手动将该素材关联到指定分镜段;关联成功后触发重新匹配
- `POST /api/tasks/:id/revise` —— 局部修改(换素材/改字幕/调顺序),回到 PREVIEW_PENDING
- `POST /api/tasks/:id/confirm-preview` —— 确认预览,进入 QC_RUNNING
- `POST /api/tasks/:id/retry-qc` —— 质检失败修改后重新提交质检
- `GET /api/tasks/:id/export` —— 获取导出产物下载链接

### Worker 内部任务(BullMQ jobs,非HTTP)
- `segment-script` —— 按自然段规则拆分脚本
- `match-materials` —— 按标签树重合度给素材打分匹配,写入 task_segments,判断是否充足
- `render-draft` —— FFmpeg拼接+烧字幕,输出草稿视频
- `run-qc` —— 黑屏/静音/字幕越界检测,写入 qc_reports

---

## 6. 前端页面清单

### 学员端(对应客户提供的原型截图)
| 路由 | 内容 |
|---|---|
| `/login` | 账号或密钥登录 |
| `/` | 首页:运营置顶模板卡片 + 快速开始(选文案包生成)+ 最近作品预览 |
| `/works` | 我的作品列表,tab:全部/已完成/处理中/失败 |
| `/works/[id]` | 作品详情、预览播放器、下载按钮、失败重试 |

### 运营后台(同项目下 `/admin` 路由,按 role 区分权限)
| 路由 | 内容 |
|---|---|
| `/admin/tags` | 标签分类树管理:新建/编辑节点、调整层级 |
| `/admin/materials` | 素材库管理:上传、勾选分类树标签 |
| `/admin/scripts` | 文案管理:新建/编辑文案、触发自动分段、给分段勾选标签 |
| `/admin/tasks` | 任务队列列表,按状态筛选 |
| `/admin/tasks/[id]` | 任务详情:分镜编辑(换素材/改字幕/调顺序)、质检报告查看、人工确认按钮。素材不足的分镜段旁边有"去素材库上传"按钮,跳转 `/admin/materials?returnTaskId=xxx` 上传打标签后,自动带返回入口回到本页,在该分镜段的素材选择器里选中刚上传的素材完成关联 |

---

## 7. 质检规则(MVP自动化部分)

| 检测项 | 实现方式 |
|---|---|
| 黑屏 | FFmpeg `blackdetect` filter,输出黑屏时间段,超过阈值判fail |
| 静音 | FFmpeg `silencedetect` filter,检测音轨静音区间 |
| 字幕越界 | 对比字幕文本长度/时长与画面时间轴,超出预设阈值判fail |

三项检测跑完写入 `qc_reports`,全部pass才能进 `QC_PASSED`,任一fail打回 `REVISING`。

---

## 8. 部署方案

```
docker-compose.yml
├── web        (Next.js, 端口 3000)
├── worker     (Node + BullMQ + FFmpeg)
├── postgres
├── redis
└── nginx      (反向代理 + 静态文件服务,可选)
```

- 服务器:国内云服务器,2核4G起步(纯CPU跑FFmpeg拼接对MVP阶段的素材量够用,渲染压力上来再加配置)
- 存储:MVP先用本地磁盘挂载卷(`/data/materials`, `/data/exports`),验证跑通后再迁移OSS/COS,减少前期接入成本

---

## 9. 分期计划

| 阶段 | 内容 |
|---|---|
| **MVP(本文档范围)** | 投流素材混剪核心闭环:规则式分段+标签匹配,人工补素材,纯混剪+字幕,自动质检三项 |
| Phase 2 | 接入TTS自动配音;自建 Wav2Lip/SadTalker 做口型同步 |
| Phase 3 | AI素材补充(素材不足时的文生视频/图生视频兜底)、数字人生成 |
| Phase 4 | 自然流模板模块、辅助剪辑高级自定义模式、学员token计费(接入现有 aitoken.homes relay) |

---

## 10. 设计决策记录

| 事项 | 决策 |
|---|---|
| 标签体系 | 预设分类树(`tag_categories`),不用自由文本标签。开工前需先和运营/客户过一遍第4节给出的初始树结构 |
| 文案分段规则 | 按自然段拆(原文换行/空行切段),不按句号、不按固定字数 |
| 素材不足处理入口 | 运营从任务详情页跳转素材库页面上传并打标签,回到任务详情页手动将素材关联到对应分镜段(`link-material` 接口),非任务页内嵌上传 |
