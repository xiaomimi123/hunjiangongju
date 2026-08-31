# 双语字幕 + 后台可选字体 + 剪辑参数画布 部署清单

> 部署机制（打包/上传/清旧解压/自动迁移）沿用 [`CUTOVER.md`](./CUTOVER.md) 的「日常更新」小节。本文只列**这个版本特有的注意事项与验收**。服务器 `101.37.151.152`，`docker compose -f docker-compose.prod.yml --env-file .env.prod`。

## 0. 这个版本改了什么

| 功能 | 对存量用户的影响 |
|---|---|
| 中英双语字幕（框架级开关，默认**关**） | 无。英文早就在逐拍生成、只是从未被渲染；本版接通。关着双语的框架生成时会**跳过翻译**，省 LLM 调用 |
| 后台可选字体（内置 5 款 + 支持上传） | 无。未选字体的框架仍用原来的思源黑体 Regular |
| 剪辑参数所见即所得画布 | 无。纯后台 UI，不参与渲染 |

**已实测的零回归证据**：拿一份「未配任何新参数」的存量框架输入，在改动前后两个 commit 上各真渲一遍，
10 个采样点（开场碎裂 / 快闪卡 / 正片 / 转场）帧哈希**逐字节相同**。输入刻意构造成最危险的情形
——框架没配新参数、但任务数据里英文**有值**（模拟老任务），结果英文一个字都没渲出来。

**⚠️ 本版唯一的部署硬要求：字体文件必须真的进到镜像里。** 见 §2 第 5 步。

## 1. 前置
- `main` 已推送（`7639496`）。服务器可以 `git pull`，也可继续走 tar 包。
- 本机打包：`git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD` → scp 上传。
  **包现在约 38MB**（字体目录未压缩 52MB，本版新增 4 个字体共约 46MB），
  上传耗时与服务器磁盘余量留意一下。
- 无新增环境变量，`.env.prod` 不用改。

## 2. 部署（可直接整段粘贴）

```bash
# ── 本机 ──
cd /Users/lizhishaoniange/Documents/电商带货混剪工具
git archive --format=tar.gz -o dongfangwenlan.tar.gz HEAD
scp dongfangwenlan.tar.gz root@101.37.151.152:~/

# ── 以下在服务器 ──
cd ~/dongfangwenlan
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

# 1) 备份数据库（务必，唯一的后悔药）
$C exec -T postgres pg_dump -U mixcut mixcut > ~/backup_before_fonts_$(date +%F_%H%M).sql
ls -lh ~/backup_before_fonts_*.sql     # 确认非空

# 2) 清旧代码再解压（★ tar 不删旧文件，见 CUTOVER 的坑）
find . -maxdepth 1 -mindepth 1 ! -name '.env.prod' ! -name 'data' -exec rm -rf {} +
tar -xzf ~/dongfangwenlan.tar.gz -C ~/dongfangwenlan

# 3) 建自定义字体目录（上传接口自己也会建，提前建可避免权限意外）
mkdir -p data/fonts

# 4) 构建启动（migrate 服务自动应用 custom_fonts 迁移）
export COMPOSE_BAKE=false
$C up -d --build

# 5) ★★ 验字体真的在镜像里（本版最要紧的一步，见下方说明）
$C exec worker ls -l /app/worker/templates/booklist/fonts/
# 期望看到 5 个文件，其中 NotoSansSC-Regular.otf 为 8331336 字节

# 6) 确认迁移跑了
$C logs migrate | tail -20
```

### 为什么第 5 步不能省

本版把烧字幕的 fontsdir 改成了 per-task 精简目录，并且**字体文件缺失时是响亮失败**
（直接抛错、整条渲染中断），而不是像以前那样静默回落到系统字体。

这是刻意的设计取舍——静默回落的后果是中文渲成豆腐块、日志毫无异常，排查成本极高。
但代价是：**万一部署漏传了字体目录，所有学员的所有任务渲染都会挂掉**，不是画面变糙。
所以第 5 步是这一版的部署闸门，务必执行。

若第 5 步失败：多半是 tar 包没传全或解压不完整，重传重解压即可（`.dockerignore` 已确认
不排除字体文件，`git archive` 也确认会带上这 5 个文件）。

## 3. 数据库迁移

只有一条：`20260830161812_custom_font`，内容是单条 `CREATE TABLE "custom_fonts"`，
**不 ALTER、不碰任何现有表、无索引重建**，在有数据的生产库上是秒级无锁。

```sql
CREATE TABLE "custom_fonts" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 400,
    "file_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_fonts_pkey" PRIMARY KEY ("id")
);
```

compose 里 `web` 与 `worker` 都声明了
`depends_on: migrate: { condition: service_completed_successfully }`
（`docker-compose.prod.yml:52-54` / `:62-64`），所以迁移**必然先于两个服务完成**，
不存在「表还没建好就有人访问」的窗口。无需额外手动跑 `migrate deploy`。

## 4. 上线后验收

**先验存量不受影响，再验新功能。**

1. **★ 存量冒烟（最重要）**：拿一个**没改过任何字体/双语设置**的框架跑一条任务。
   出片后与上线前的成片对比，重点看**书名大标题的粗细**——这是本版唯一有回归风险的面
   （内置字体新增了思源黑体 Bold，与 Regular 同族名）。粗细应当**完全一致**。
2. **学员端**：学员登录 → 作品详情页轮询正常、进度显示正常、下载成片/SRT 正常。
   （本版学员端零改动，SRT 里本来就只有中文，不会突然冒英文。）
3. **字体功能**：`/admin/settings/fonts` 能看到 5 款内置字体；上传一个自有 .ttf/.otf
   能解析出族名与字重（解析失败会拒收，这是刻意的）。
4. **画布**：`/admin/frameworks/<id>/studio` 与 `/admin/generate/<id>/studio` 顶部出现
   「画面预览 · 可直接拖」卡片，三个场景（开场/快闪/正片）都能画出来，拖动文字层数值会跟着变。
5. **双语**：随便挑个框架开双语 → 重新生成一条 → 成片上中文在上、英文紧贴其下，
   且**中文行位置与开双语前完全一致**（这条已在单测、真渲染 e2e、浏览器三处验过）。

## 5. 回滚

代码回滚照 CUTOVER：部署上一个 tar 包即可。
**数据库不需要回滚**——`custom_fonts` 是纯新增表，老代码不读它，留着无害。

## 6. 已知项（不阻断上线）

- **per-task 字体目录是复制而非硬链接**：每条片子会把选中的字体复制进 `data/gen/<id>/hf/fonts/`，
  且渲染完不清理。未选字体的框架只复制默认的思源黑体（8.3MB，与本版之前持平）；
  若某框架正文与标题都选了霞鹜文楷（24.7MB），每条片子会多占约 25MB。
  磁盘吃紧时可考虑改硬链接，或定期清理 `data/gen/*/hf/`。
- **站酷快乐体只有 7055 个字形**（展示体）：生僻书名/作者名可能出豆腐块，
  用它之前建议先在画布上预览。其余 4 款均 3 万字形以上。字体管理页已有此提示。
- **画布是示意预览不是渲染器**：字距、CJK 断行、描边叠加顺序与成片仍有细微差异，
  最终以成片为准（画布上有常驻提示）。

## 7. 排错

- **渲染报错含 `prepareFontsDir`**：字体文件缺失或路径不对。执行 §2 第 5 步核对，
  多半是 tar 没传全。这是设计上的响亮失败，不是 bug。
- **成片字幕变豆腐块**：本版之后不该再出现（缺字体会直接报错而非静默回落）。
  若出现，说明 fontsdir 里有字体但族名对不上，看 worker 日志的 `fontselect:` 行。
- **运营选了字体但成片没变化**：确认该框架**重新生成**过（改字体只影响以后生成的片子，
  已生成的不会自动重渲）。
- 其余（onnxruntime 302 / next build 残留旧文件）见 CUTOVER「常见问题」。
