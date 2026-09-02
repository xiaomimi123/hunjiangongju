# 扣子（Coze）工作流工具箱 部署清单

> 本版新增学员端「工具广场」与后台「扣子工具」管理，运营无需写代码即可把扣子平台上搭好的工作流（文案改写、标题生成等）直接上架给学员使用。学员提交表单运行工具时扣积分、失败自动退回。
> 部署机制（打包/上传/清旧解压/自动迁移）沿用 [`CUTOVER.md`](./CUTOVER.md) 的「日常更新」小节。本文只列**这个版本特有的注意事项与验收**。服务器 `101.37.151.152`，`docker compose -f docker-compose.prod.yml --env-file .env.prod`。

## 0. 这个版本改了什么

| 功能 | 对存量用户的影响 |
|---|---|
| 扣子工具箱（后台导入 + 学员端广场） | 无。纯新增功能，不涉及现有的混剪流水线、积分体系改动 |
| Worker 新增 coze-run 队列 | 无。独立队列（并发 2），与现有视频渲染队列分离，不争抢资源 |

纯新增功能，不触碰渲染链路代码（diff 可查）。

## 1. 前置

- `main` 已推送。服务器可以 `git pull`，也可继续走 tar 包。
- 本机打包：`git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD` → scp 上传。
- 无新增环境变量，`.env.prod` 不用改。
- 无新增依赖（npm / pip / 系统包）。

## 2. 部署（可直接整段粘贴）

照 [`DEPLOY-subtitle-font-stage.md` §2 的命令](./DEPLOY-subtitle-font-stage.md#2-部署可直接整段粘贴)，无需改动。migrate 服务会自动应用新表 `20260902120000_coze_tools`。

```bash
# ── 本机 ──
cd /Users/lizhishaoniange/Documents/电商带货混剪工具
git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD
scp dongfangwenlan.tar.gz root@101.37.151.152:~/

# ── 以下在服务器 ──
cd ~/dongfangwenlan
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

# 1) 备份数据库（务必）
$C exec -T postgres pg_dump -U mixcut mixcut > ~/backup_before_coze_$(date +%F_%H%M).sql
ls -lh ~/backup_before_coze_*.sql

# 2) 清旧代码再解压（★ 绝对路径 + 守卫）
APP=/root/dongfangwenlan
test -f "$APP/docker-compose.prod.yml" || { echo "❌ $APP 不像应用目录，已中止"; exit 1; }
find "$APP" -maxdepth 1 -mindepth 1 ! -name '.env.prod' ! -name 'data' -exec rm -rf {} +
tar -xzf ~/dongfangwenlan.tar.gz -C ~/dongfangwenlan

# 3) 建新目录（代码会自动 mkdir，提前建可避免权限意外）
mkdir -p data/coze data/coze-uploads

# 4) 构建启动（migrate 服务自动应用 coze_tools 迁移）
export COMPOSE_BAKE=false
$C up -d --build

# 5) 确认迁移跑了
$C logs migrate | tail -20
```

## 3. 数据库迁移

一条，纯新增、秒级、无锁，不碰任何现有数据。

**`20260902120000_coze_tools`** —— 扣子工具与学员运行记录表：

```sql
CREATE TABLE "coze_tools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "workflow_id" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "price_credits" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coze_tools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coze_tool_runs" (
    "id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "output_raw" JSONB,
    "output_items" JSONB,
    "error_msg" TEXT,
    "credits_cost" INTEGER NOT NULL,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "coze_tool_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coze_tool_runs_user_id_created_at_idx" ON "coze_tool_runs"("user_id", "created_at");
```

PostgreSQL 11+ 建表无锁，迁移秒级完成。compose 里 `web` 与 `worker` 都声明了
`depends_on: migrate: { condition: service_completed_successfully }`，
所以迁移**必然先于两个服务完成**，不存在「表还没建好就有人访问」的窗口。无需额外手动跑。

## 4. 新目录

部署时代码会自动建立，但提前手动建可避免权限意外：

- `data/coze/`：扣子 API 返回的输出文件（图片/视频）的转存目录。扣子的 URL 会过期，
  必须在本站落盘并通过 `/api/files/coze/...` 访问。
- `data/coze-uploads/`：学员上传的图片临时目录（jpg/png/webp，≤10MB）。

## 5. 上线后配置步骤

1. **配置扣子 PAT Token**
   - 登录 https://www.dfwl.top 后台 → **系统 → 模型配置**
   - 找「扣子工作流」行，填入：
     - 接口地址：`https://api.coze.cn`
     - 模型：留空
     - 密钥：扣子官方的 Personal Access Token（PAT）
   - 点「测试连通」→ 通过后点**启用**

2. **后台导入第一个工具**
   - **生成 → 扣子工具**
   - 新建 → 填 workflow_id → 「从扣子拉取参数」
   - ⚠️ **如果「从扣子拉取参数」失败**（接口暂未真实验证），说明文字会提示手动添加
     → 逐个添加输入项：填参数名 → 选择中文标签、类型（单行/多行/下拉/图片）、
     是否必填，下拉则填选项 → 保存
   - 配价格（积分/次，可自定义）→ 保存
   - 工具列表勾选「上架」启用工具

3. **学员端验证**
   - 学员登录 → 首页「工具广场」（假如已启用任何工具）
   - 点工具进表单页 → 顶部显示「N 积分/次」与当前余额
   - 填表单提交 → 自动扣分 → 跳结果页轮询运行状态
   - 成功后看到结果（文本/图片/视频）

## 6. 上线后验收

**先验存量不受影响，再验新功能。**

1. **★ 存量冒烟（最重要）**：无需验。学员拉取/生成作品的链路完全未改，
   与此版本无交集。倘若与其他功能同版本发布，按现有冒烟流程再走一遍。

2. **后台导入**：填任意真实 workflow_id → 点「从扣子拉取参数」
   - 拉到 → 参数自动列出，确认无误保存
   - 拉不到 → 手动逐项添加，点「保存」确认无误

3. **学员端运行**：学员余额充足 → 进工具页 → 选填表单 → 提交
   - 状态轮询从 QUEUED → RUNNING → SUCCEEDED
   - 结果按类型展示：文本（含复制按钮）、图片/视频（含预览+下载）

4. **积分扣减**：学员提交前后积分值对比
   - 成功：扣价格配置的那个数字
   - 失败：先扣后退，最终余额不变

5. **上架 / 下架**：工具从启用改禁用 → 学员端刷新「工具广场」
   - 工具即刻消失，已有的运行记录仍保留
   - 学员若想重跑该工具，需运营重新启用后才行

6. **余额不足**：余额 < 工具价格 → 提交时弹 NO_CREDITS 二维码（复用现有充值流程）
   - 不会建 run，积分无扣减

## 7. 回滚

代码回滚照 CUTOVER：部署上一个 tar 包即可。
**数据库不需要回滚**——`coze_tools` 与 `coze_tool_runs` 是纯新增表，老代码不读它，留着无害。

## 8. 排错

### 学员提交时得到中文报错

这是预期行为。常见错误（逐字对照代码，见 `packages/db/src/ai/coze.ts` 与 `worker/src/coze/run.ts`）：

- **「扣子未配置，请在模型配置里填 Token」**：Token 未在后台「模型配置」启用。需运营补配 Token → 点启用。
- **「图片参数「字段名」路径不合法：…」**：提交里的图片相对路径没通过 worker 端的二次校验（正常提交走不到这条，多半是被篡改的请求）。
- **「扣子运行工作流失败: …」**：扣子那边工作流出错（如输入参数不对、第三方 API 调用失败等）。
  原始返回暂无界面可看，需要时查库 `coze_tool_runs.output_raw`。

### Worker 日志查看

```bash
# 服务器上
docker compose -f docker-compose.prod.yml --env-file .env.prod logs worker | grep -i 'coze\|queue' | tail -50
```

关键关键词：
- `[coze]`：标记的是 coze-run 队列相关日志
- `QUEUED → RUNNING`：表示任务入队并开始处理
- `SUCCEEDED`：扣子返回成功结果
- `FAILED`：扣子返回失败，应自动退积分

### 积分扣减与退回异常

- **提交成功但没扣分**：数据库 `users` 表的 `credits` 列应该改变。检查 `coze_tool_runs` 表该条 run 的 `status` 是否 SUCCEEDED，`credits_cost` 字段。
- **成功但积分反复改变**：不应该发生。BullMQ 队列默认 `attempts=1`，不会自动重试；即便同一 run 被重复投递（如手工误操作），worker 有终态状态闸 + refunded 幂等闸（`worker/src/coze/run.ts:114-138`），重复处理是安全的，不会重复扣分或重复退分。若真的看到同一 run 被重复扣分，说明状态闸失效，是要立即当 bug 排查的问题，不是已知软件债。
- **积分未退回**：`coze_tool_runs` 表该 run 的 `status` 是 FAILED 但 `refunded` 仍为 false。
  检查 worker 日志是否有退积分阶段的错误。

## 9. 已知项（不阻断上线）

- **真实 API 已 spike 验证（2026-09-03，coze.cn）**：
  - 运行走**异步**：`is_async: true` 提交拿 `execute_id`，轮询 `run_histories` 到终态
    （同步 run 对视频类慢工作流零字节挂死，已弃用）。总预算 30 分钟，轮询间隔 10 秒。
  - 参数拉取接口（工作流详情）只返回元数据、**没有参数 schema**——后台「从扣子拉取」
    注定拉不到参数，运营请直接手动逐项添加输入项（探参数可在扣子编排页看开始节点）。
  - 扣子 `run_histories` 响应存在**非法 JSON 转义 bug**（嵌套 node_status），
    解析层已做正则兜底 + URL 抢救，不会因此误判运行失败或丢产物链接。
  - 文件参数格式 `{"file_id":"..."}` JSON 字符串已实测通过；上传返回 `data.id`。
  - **令牌须用 `pat_` 开头的个人访问令牌**（勾选目标空间 + Workflow/File 权限）；
    扣子示例代码里 `cztei_` 开头的是十几分钟就过期的临时令牌，配进后台必然很快失效。
  - **工作流必须已发布**且在令牌可访问的空间里；别人空间的工作流建议复制到自己空间再发布。
- **重复投递不是隐患**：BullMQ 默认 `attempts=1`，不会自动重试；worker 端另有终态状态闸 + refunded
  幂等闸（`worker/src/coze/run.ts:114-138`），即使发生重复投递（stalled 重发、手工重入队）也不会
  重复扣分/重复退分，本条不是待修事项，此处仅作说明。
- **上传文件不自动清理**：学员上传的图片在 `data/coze-uploads/` 逗留。
  run 完成后没有显式删除逻辑，运维需定期手动清理（如 `find data/coze-uploads/ -mtime +7 -delete`）。

## 10. 常见问题

- **学员上传的图片太大（>10MB）会怎样？**
  服务端校验拒收（`web/app/api/tools/upload/route.ts`），返回 400「图片不能超过 10MB」。不会建 run，积分无扣减。

- **扣子工作流返回我没见过的数据格式会怎样？**
  识别不出任何展示项时，结果页显示「本次运行没有可展示的结果」，不会报错。

- **同一学员同时提交两个请求会怎样？**
  都会入队扣积分。无全局并发锁，两条 run 会并行执行。

- **扣子平台维护无法服务会怎样？**
  学员提交后 worker 调用扣子失败，run 直接落 FAILED 并自动退积分（BullMQ 默认 `attempts=1`，
  不会自动重试）。学员在「我的记录」里能看到运行失败的状态与错误信息。
