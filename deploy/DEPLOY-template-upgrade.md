# 模板升级（运镜+美术）+ TTS 段级对齐 部署说明

> 服务器 `root@101.37.151.152`，域名 `www.dfwl.top`。部署机制沿用 [`CUTOVER.md`](./CUTOVER.md) 的「日常更新」小节。
> 本次是**纯代码更新**：无新环境变量、无 compose 改动。本文只列本版本相关点与验收。

## 本次改了什么
- **视频出片模板重写**（`worker/templates/booklist/`）：运镜从"单一缓推近"升级为 6 招式 + 5 转场按段确定性轮换；美术落设计 token + 3 套风格预设（warm-literary / dark-premium / ink-oriental）+ 字幕压暗底 + 模糊填充 + 书名头 kicker + 逐字浮现字幕。全自动，无运营侧交互变化。
- **TTS 段级对齐**（`generateTts`/`alignCaptions`/`renderVisuals`）：逐段配音取真实时长做精确 bodyTimings，根治字幕与口播错位。
- 引擎不变（仍 `hyperframes@0.7.33`），流水线全自动不变。

## 迁移
本次功能本身**不新增迁移**。`migrate` 服务跑 `prisma migrate deploy`（幂等），会补齐任何未应用的迁移。相对上次可能待应用的都是**加列**（安全、无数据丢失）：
`add_cloned_voice` / `add_segment_book_fields` / `add_caption_beats` / `add_degraded_note`。

## 环境变量
无新增。确认 `.env.prod` 里 M1/M2 已配的两项仍在（真 ASR/声音复刻/vision 靠它拉本服务器文件）：
`ASSET_URL_SECRET=<随机串>`、`PUBLIC_BASE_URL=https://www.dfwl.top`。

## 部署步骤

```bash
# ── 0) 本机：打包最新代码（当前 HEAD=模板升级已合入）并上传 ──
cd /Users/lizhishaoniange/Documents/电商带货混剪工具
git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD
scp dongfangwenlan.tar.gz root@101.37.151.152:~/

# ── 1) 服务器：先备份数据库（务必）──
cd ~/dongfangwenlan
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C exec -T postgres pg_dump -U mixcut mixcut > ~/backup_tpl_$(date +%F_%H%M).sql
ls -lh ~/backup_tpl_*.sql   # 确认非空

# ── 2) 服务器：先清旧代码再解压（保留 .env.prod 与 data/）──
find . -maxdepth 1 -mindepth 1 ! -name '.env.prod' ! -name 'data' -exec rm -rf {} +
tar -xzf ~/dongfangwenlan.tar.gz -C ~/dongfangwenlan

# ── 3) 构建并启动（migrate 自动补齐待应用迁移）──
export COMPOSE_BAKE=false
$C up -d --build

# ── 4) 确认迁移与服务 ──
$C logs migrate | tail -20        # 全部 applied / No pending migrations 均可
$C ps                              # web/worker/caddy/postgres/redis 均 Up
```

## 验收（重点验本次改动）
1. 运营 `/admin/generate` 选一个已发布框架 + 填选题 → 生成 → 等 EXPORTED。
2. 播放/抽帧成片，重点看：
   - **字幕对齐**：字幕与口播逐句同步（本次核心修复；旧版首句会晚出好几秒）。
   - **运镜**：相邻段运镜/转场有变化，不再全片一个缓推近。
   - **美术**：书名头带强调色 kicker、字幕有渐变压暗底清晰可读、整体像有设计感的书单号。
3. 想指定风格：给框架的 `overlay_template` 加 `"__style":"dark-premium"`（或 `warm-literary`/`ink-oriental`）；不填则按任务 id 自动分配。

## 回滚
```bash
cd ~/dongfangwenlan
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C down
$C up -d postgres && sleep 8
cat ~/backup_tpl_*.sql | $C exec -T postgres psql -U mixcut -d mixcut
# 再部署上一个 tarball / 上一版代码后 up -d --build
```

## 排错
- 渲染报 hyperframes/chromium：worker 镜像装 chromium 偶发失败，重建一次（`$C build --no-cache worker` 后 `up -d`）；确认 `worker/Dockerfile` 有 chromium 与 `HYPERFRAMES_BROWSER_PATH`。
- 构建卡 npm/onnxruntime/apt：见 [`CUTOVER.md`](./CUTOVER.md) 常见问题（CN 镜像源已内置、`ONNXRUNTIME_NODE_INSTALL=skip`）。
- `next build` 报 Prisma 属性不存在：原地解压残留旧文件——务必先执行第 2 步的 `find ... -exec rm -rf`。
