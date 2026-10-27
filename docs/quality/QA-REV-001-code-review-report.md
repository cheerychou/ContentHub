---
doc_id: QA-REV-001
title: ContentHub 代码仓审查报告
category: QA
domain: REV
status: active
version: 1.0
author: zhoudabo
created_at: 2026-09-24
updated_at: 2026-10-27
tags: [代码审查, 全仓审查, 质量]
---

# ContentHub 代码仓审查报告

审查日期：2026-09-24
审查对象：https://github.com/cheerychou/ContentHub （账号 `cheerychou` / zhoudabo 唯一公开仓库）
审查方式：全量克隆后逐文件精读；后端 15 个模块 + 3 路由 + 迁移 + 21 个测试，前端 40+ 文件 + 与后端契约交叉比对。
所有结论均带 `文件:行号` 证据。前端因 `node_modules` 缺失，TS/lint/测试结论为静态配置推断（已标注）。

---

## 一、仓库总体情况

### 1.1 基本事实

| 项目 | 值 |
|---|---|
| 仓库名 | ContentHub |
| 定位 | 面向企业/平台的 AI-Native 数字内容供应链系统（A-DCSC），内容「存储→制作→管理→分发」全链路 |
| 技术栈 | 后端 FastAPI + SQLAlchemy 2.0 + PostgreSQL 16 + MinIO + Playwright + edge-tts；前端 React 19 + Vite 8 + Tailwind 4 + TS |
| 语言构成 | TypeScript 209k / Python 189k / CSS 28k 字节 |
| 代码规模 | 约 10.5k 行（前端 ~8.5k、后端 app ~1.9k） |
| 文档规模 | docs/ 10 篇 799 行 + plans/ 12 篇 4217 行 = 5016 行 |
| 提交 | 103 commits，单一作者 zhoudabo |
| 分支 | `main` + `feature/m6-app-shell`（落后 main 22 次提交、领先 0，实为已合并的陈旧分支） |
| 工程配置 | 无 CI（`.github` 不存在）、无 LICENSE、无 `.env.example`、无 tag、无 lock 文件 |
| 测试 | 后端 21 个测试文件 / 2120 行（app 源码 1946 行，测试:代码 > 1:1）；前端仅 2 个测试文件 |

### 1.2 阶段判断

README 自述「M0 资产底座已可自托管运行，后续工程能力待业务定型后逐步落地」，与代码实况吻合：**M0–M7 的功能骨架已真实落地且可用**（资产上传/抽取、选题工作台、母版派生、封面渲染、文本变体、语音包三件套均已实现并带测试），但**工程化边界（认证、日志、分层、前端拆分、构建加固）尚未跟上**。

这是一个典型的**单人驱动、AI 辅助、文档先行**的「方案期→MVP 期」仓库：文档治理反而比代码工程化更成熟。

### 1.3 值得肯定的设计（请勿在重构中改坏）

这些是本仓库明显高于同阶段项目水准的地方，修复问题时必须保留：

1. **`rendering.py:5-8` 主动使用 Jinja2 `SandboxedEnvironment`** 防 SSTI —— 安全意识正确。
2. **`media_attrs.py` 的失败隔离设计**：属性抽取失败绝不影响上传结果，且有测试守护（`tests/test_media_attrs.py:97`）。
3. **`assets.py:83` 小文件「先抽取后落盘」** 防孤儿对象，并有断言 `fake.objects == {}` 的测试（`tests/test_assets_api.py:165`）。
4. **`conftest.py:27-31` 测试库名守卫** —— 防止测试误连生产库。
5. **`alembic/versions/c3d9f1a02b47:21-31`** 对 PG 枚举 `ALTER TYPE ADD VALUE` 必须 `autocommit_block` 的处理与注释 —— 这是很多人会踩的坑。
6. **storage / llm / speech 的 `Protocol` + `Fake` 双实现**：让测试不依赖 MinIO/LLM/TTS 外部服务，架构干净。
7. **`tests/test_cleanup_orphans.py` + `scripts/cleanup_orphans.py` 默认 dry-run** —— 危险运维操作默认安全，是很好的习惯。
8. **前端暗色 FOUC 修复**（`index.html:8-19` 同步内联脚本 + `topbar.tsx:23-37` 双侧 try/catch）—— 标准解法。
9. **前端 `tokens/` 8 个文件分层清晰无重复**（539 行），设计令牌体系完整。
10. **移植组件带来源/许可证/裁剪原因注释**（`data-table.tsx:18-19`、`detail-page-layout.tsx:14-20`、`sidebar.tsx:1-10`）—— 可维护性正面示范。
11. **`primary-task.ts` 是全仓唯一逻辑/视图分离的模块**（154 行测试，`it.each` 用得好）—— 应作为前端重构的模板推广。
12. **后端测试比 > 1:1，且覆盖了不少失败路径**（损坏 docx、属性失败隔离、渲染引擎 503、TTS 异常等），不是只测 happy path。

---

## 二、高危问题（建议优先处理）

### 2.1 【高】全站零认证鉴权，且端口直接暴露

**证据**：`backend/app/main.py:1-13` 无任何中间件；全部 router 无鉴权依赖；全仓 grep `OAuth2|HTTPBearer|Security|APIKeyHeader` **零命中**；`docker-compose.yml` 将 api 发布到宿主机 `8001:8000`。

**影响**：任何可达者可以：
- `DELETE /api/assets/{id}`（`assets.py:301`）不可逆删除对象与记录；
- `POST /api/recipes` 写入任意模板；
- 读取全部内容正文；
- 调用 `/derive-text`（`assets.py:517`）**消耗你的 LLM 额度**；
- 调用 `/derive-video-kit`（`assets.py:570`）消耗 TTS。

**建议**：加一个 `X-API-Key` 依赖（写接口与 `/api/meta` 之外的端点强制校验），密钥走环境变量；`/api/health` 保持公开。这是**当前最大的单点风险**，且改动量很小（新增 1 个文件约 30 行）。

### 2.2 【高】模板 × Chromium = SSRF / 本地文件读取

**证据**：`routers/recipes.py:22` 允许任意人写入 Jinja2/HTML 模板；`assets.py:481-489` 渲染后由 Playwright 以 `file://` 打开（`rendering.py:18-28`）。

**分析（重要区分）**：`SandboxedEnvironment` 已正确挡住 **Jinja2 层**的 SSTI。但**模板本身就是 HTML/JS**，沙箱管不到浏览器行为：
- `<img src="http://169.254.169.254/latest/meta-data/...">` → 打云元数据（SSRF）；
- `<iframe src="file:///etc/passwd">` → 本地文件读取；
- `<script>fetch(...)</script>` → 配合 `wait_until` 可外发数据。

**建议**：① 模板写入端点限管理员（与 2.1 一起做）；② 渲染时用 Playwright `route` 拦截，**只允许 `file://` 与 data URI，阻断所有 http(s) 出站**。第二项是根治手段。

### 2.3 【高】`async def` 路由里做同步阻塞 IO

**证据**：`create_asset`（`assets.py:148`）、`create_initial_draft`（`:320`）、`derive_from_master`（`:371`）是 `async def`，但经 `store_upload`（`:73-131`）在**事件循环上**执行：2GB 上传、`ffprobe`（`timeout=120`）、Pillow 50MB 解码、`shutil.copyfileobj`、同步 `db.flush/commit`。

**影响**：单个大视频上传会**卡死整个服务**——`/api/health` 不响应、docker healthcheck 误判并重启容器。

**对照**：`render-cover` / `derive-text` / `derive-video-kit` 写的是 `def`，走 threadpool，**这是对的**。

**建议**：把这三个路由的 `async def` 改为 `def`（一行改动，立即让 FastAPI 丢进 threadpool）。若坚持 async，则必须用 `run_in_threadpool` / `anyio.to_thread.run_sync` 包裹所有同步 IO。

### 2.4 【高】列表接口返回整篇正文，最坏 2.5GB JSON

**证据**：`schemas.py:52` 的 `AssetOut.text_content` + `assets.py:208` 默认 `limit=50` + `assets.py:51` 正文上限 50MB → **最坏 50 × 50MB = 2.5GB 响应体**。

**影响**：一次列表请求即可打满内存/带宽，前端解析卡死。

**建议**：列表用独立 DTO（不含 `text_content`，只给 `summary`/`has_text`），详情接口才返回正文。改动约 20 行，收益极大。

### 2.5 【高】`spec` 参数存在确定的 500 bug + DoS

**证据（已亲自验证）**：`cover_specs.py:39` 执行 `int(v)`：
- `spec='{"width":{}}'` → `int({})` 抛 **`TypeError`**；
- `spec='["a"]'` → `override.items()` 抛 **`AttributeError`**；
- 而 `assets.py:470` 只捕 `(json.JSONDecodeError, ValueError, KeyError)` → **未捕获，直接 500**。

同时**尺寸无上限**：`spec_for` 只做 `int(v)`，`{"width":50000,"height":50000}` 配 `device_scale_factor=2`（`rendering.py:26`）≈ **80GB 位图** → 直接 OOM。

现有测试 `test_render_cover_api.py:116` 只覆盖了 `spec="not-json"` 这一条合法失败路径，所以从未暴露。

**建议**：用 Pydantic 模型校验 spec（`width/height: int = Field(ge=64, le=8192)`），删掉手工 `int()`。约 15 行。

### 2.6 【高】MinIO 预签名 URL 浏览器不可达

**证据**：`config.py:8` 的 `minio_endpoint` 同时用于 SDK 连接**与**预签名 URL 生成（`storage.py:51-55`）；compose 设 `CH_MINIO_ENDPOINT=minio:9000` → 返回给浏览器的 `file_url`（`assets.py:239/513/623`）是容器内主机名，**浏览器必然解析失败**。

前端已在 `api.ts:30` 打补丁：`replace(/^https?:\/\/minio:9000/, "/minio")` —— 这是**把后端缺陷用前端 hack 掩盖**，且只在 `getAsset` 一处，其余端点返回的 `file_url` 仍不可用。

另：`storage.py:24` 的 `secure=False` 硬编码，无法启用 TLS。

**建议**：拆出 `CH_MINIO_PUBLIC_ENDPOINT`（用于预签名）与内部 endpoint；`secure` 改为配置项。然后**移除前端 hack**。

### 2.7 【高】前端 TS `strict` 从未开启

**证据（已亲自验证）**：`frontend/tsconfig.app.json:2-27` 有 `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch`，**唯独没有 `strict`**；`git log -S'"strict"' -- frontend/tsconfig.app.json` **返回空** → 历史上从未出现过。`tsconfig.json:1-7` 只有 `files` + `references`，不注入 compilerOptions。

**影响**：全仓 `strictNullChecks` 关闭 —— 上述 2.4/2.5 类「字段可能为 null」的问题在编译期完全不可见。这是**唯一能阻止其他修复退化的保险丝**，却只是一行配置。

**建议**：开 `"strict": true`，并把 `tsc -b` 与 `oxlint` 接进 `Makefile:11-15` 的 `preflight`（目前只跑 `npm test`，漏了 typecheck 与 lint）。

### 2.8 【高】前端每次变更操作触发 2 次 `getAsset`，并掩盖真实 bug

**证据（已亲自验证）**：`App.tsx:409-414`
```tsx
useEffect(() => {
  if (!detail) return;
  void getAsset(detail.id).then((d) => { setDetail(d); setPubUrl(d.published_url ?? ""); })
    .catch(() => setDetail(null));
}, [assets]); // eslint-disable-line react-hooks/exhaustive-deps
```
而 14 个变更调用点都写成 `setDetail(await getAsset(id)); void refresh()`（`App.tsx:829,945,985,1014,1052,1058,1091,1169` 等）→ `refresh()` 改 `assets` → 该 effect **再发一次 GET**，且第二次响应覆盖第一次。

更糟的是：`// eslint-disable-line` 是**死指令**（项目用 oxlint，从未生效），掩盖了真实的依赖问题；`.catch(() => setDetail(null))` 是**静默 UX 黑洞**（详情刷新失败面板直接消失、无提示）。

**建议**：删除该 effect，14 个调用点改用 `reloadDetail()`。改动极局部，省一半请求。

### 2.9 【高】nginx 缺 `proxy_read_timeout`，长任务必假失败

**证据（已亲自读 `frontend/nginx.conf`）**：全文仅 `client_max_body_size 2g` + 两个 `location`，**无 `proxy_read_timeout`**（默认 60s）。而 `/derive-text`（LLM）与 `/render-cover`（Chromium）都是长任务。

**影响**：60s 后 nginx 返回 504，但**后端其实执行成功**——产生「前端报错、后端已扣费/已产出」这类最难排查的幽灵 bug。

**建议**：`proxy_read_timeout 600s; proxy_send_timeout 600s;`。成本 2 行。

---

## 三、中危问题

### 3.1 架构与分层

**Fat router，无 service 层**：`backend/app/routers/assets.py` 624 行 / 9 个端点，同时承担 HTTP 适配、状态机校验、血缘规则、事务、临时文件、subprocess、Jinja2 变量计算、TTS+SRT+zip 组装、LLM 调用。`app/` 下只有 `routers/`，没有 `services/`。

**5 处近乎逐行重复的「派生落库」块**：`assets.py:340-367`、`:386-414`、`:495-514`、`:545-558`、`:607-623` —— 都是 `add/flush/上传/commit/refresh/拼 AssetDetail`。状态机已改过一轮（`models.py:55-72`），每次都要同步 5 处。

**层级倒置**：`app/importer/obsidian.py:69` 写 `from ..routers.assets import EXT_CONTENT_TYPE` —— **数据导入器反向依赖 Web 路由层**。应提到 `app/media_types.py`。

**派生端点缺 zone 守卫（规则不一致）**：`derive_from_master`（`:381`）与 `create_initial_draft`（`:333`）严格校验 zone，但 `derive_text_for_master`（`:517-525`）、`derive_video_kit_for_master`（`:570-582`）、`render_cover_for_master`（`:459-461`）都不校验 zone。测试用例名却叫 `test_render_cover_requires_image_master`，容易误以为已覆盖。

**建议**：抽 `_persist_derived()` 与 `_detail()` 两个私有函数消重（约 80 行重构），再谈完整分层。**不建议当前就引入 repository/UoW 模式**。

### 3.2 数据层

- **`Derivation.derived_asset_id` 无索引**：`models.py:140-142` 只有 `uq_derivation_pair(source_asset_id, derived_asset_id)`；复合唯一约束的前导列 `source_asset_id` 可复用，但 **`derived_asset_id` 无索引**，而 `Asset.upstream`（`models.py:123-128`）正是按它查询 → `get_asset`（`assets.py:236`）的全表扫。
- **`assets` 表缺 `zone/status/updated_at` 索引**：`list_assets`（`assets.py:212-216`）固定按这三者过滤 + 排序。
  - 更正一个易误判点：`title`/`text_content` **已有** pg_trgm GIN 索引（`models.py:78-89`），ILIKE 搜索是走索引的，**此处无需优化**。
- **N+1 / 冗余往返**：`get_asset`（`:234-237`）3 次数据库往返，未用 `selectinload`；`importer/obsidian.py:86-93` 每个文件一次 SELECT（应先预取 `source_path` 集合）。
- **存储成功但 commit 失败 → 孤儿对象，且无补偿**：`assets.py:96/114`（先落盘后 commit）、`:505-509`、`:615-619`。有 `cleanup_orphans.py` 兜底，但默认 dry-run，需人工跑。
- **`delete_asset`（`:301-308`）先删对象后删行** → commit 失败即「行在、对象没了」，表现为「列表里有但打不开」。
- **JSONB 未用 `MutableDict`**：`models.py:110/183`，`patch_asset_attrs`（`assets.py:265-268`）靠「必须整体赋值」的隐性约定，代码注释已自认此事。
- **搜索不转义 `%`/`_`**：`assets.py:223-227`，`q="%"` 命中全表。**非注入**（参数化正确），但语义错误。
- **分页能力不完整**：`list_assets` **不返回 `total`**，`list_recipes`（`recipes.py:42-47`）**完全无分页**。
- **迁移与模型：逐项核对后无漂移**（枚举值、`source_path` unique、trgm 索引、`meta` server_default、timestamptz、recipes 表全部对齐）—— 这点做得比预期好。但 `alembic/env.py:31` 未开 `compare_type=True`（这正是 `a98ff6f65060` 需要手写的原因），`db.py:7-8` 的 `Base` 无 `naming_convention` → 未来 autogenerate 检测不到类型变更、约束名随环境漂移。

### 3.3 前端架构（App.tsx 巨石）

`App.tsx` 1180 行，其中 **`Assets` 组件占 925 行、30 个 `useState`、6 个 Dialog、`renderTask` 110 行 switch**（实测全文件 47 个 `useState`、10 个 `useEffect`、`useMemo` **0 个**）。它同时是路由层 / 页面层 / 表单层 / 任务编排层。

**判断校准**：这个前端**不是「写得差」，而是「长太快、边界没跟上」**。`components/ui/`（移植层）与 `lib/` 组织合格，问题高度集中在 App.tsx 一处。且**当前不必引入 react-router**（只有 3 个目的地），但应把路由抽成 `routes.ts` 表。

具体问题：
- **同一状态空间被三处独立遍历**：`lib/primary-task.ts:5-33`（`primaryTask`）、`App.tsx:131-165`（`nextStepHint`）、`App.tsx:527-639`（`renderTask`）。`primaryTask` 返回 `string | null`，`renderTask` 的 default 分支（`App.tsx:636`）导致**任务 key 拼错时静默渲染成空**。建议改为 `TaskKey` 联合类型 + `TASKS` 配置表。
- **手工 hash 路由三缺陷**：`App.tsx:217,220` 用 `startsWith` → `#/source-old` 误命中；`:240-246` 未知路由静默渲染成素材库（无 404）；`document.title` 从不更新。
- **四区 label 在 4 个文件重复定义**：`App.tsx:43-48`（`STAGES`，含从未读取的 emoji `icon` 死字段）、`:117-128`（`NAV`）、`:52-57`（`STAGE_PAGES`）、`dashboard.tsx:16-23`（靠注释维系同步）；且 `types.ts:90-95` 的 `ZONE_LABELS` 是另一套中文（「源料区」vs 导航「素材库」）—— 同一 zone 有 4 种标签。
- **stats 只拉一次永不刷新**（`App.tsx:213-215`）→ **上传/删除后侧栏徽标不更新**，真实功能缺陷。

### 3.4 前端数据获取

- **`api.ts` 全部 22 个函数裸用 `fetch`，无超时、无 `signal`、无去重**（`api.ts` 全文）。后端 `/derive-text`、`/render-cover` 是长任务 → 前端无限等待。
- **列表刷新存在真实竞态**：`App.tsx:375-382` 的 `refresh` 无请求序号/`AbortController` → 快速改筛选时旧响应覆盖新结果。
- **3 种错误策略分裂**：`errDetail` 解析 body（`api.ts:8-11`，12 处用）／只报状态码丢 body（`api.ts:22,28,117,210,243`）／纯字符串无状态码（`api.ts:111,147`）。
- **`normalize-error.ts` 写得好（23 行）却只被 4 个组件用**：`App.tsx:380,386,391` + `Recipes.tsx:53,60,65` 共 6 处用 `String(e)`／手写三目 → 产出 `"Error: 列表失败 500"` 脏文案。
- **无 React Query/SWR**（`package.json:16-26` 确认）—— 这是竞态 + 重复请求的**共同根因**。
- `baseURL` 两处不一致：`api.ts:3` 的 `const base="/api"` vs `api.ts:229` 字面量 `/api/health`；无 `VITE_API_BASE_URL` 覆盖。

### 3.5 前端 TypeScript

- **`strict` 未开启**（见 2.7）。
- **手写类型已与后端漂移**：`backend/app/schemas.py:50,54` 的 `object_key`/`reviewed_by` 在 `types.ts:37-49` 缺失；**后端 `AssetOut` 就有 `text_content`/`published_url`/`published_at`（`schemas.py:52,55,56`），前端只在 `AssetDetail` 有 → 列表类型在撒谎**；`DerivationOut.created_by/created_at`（`schemas.py:70-71`）在 `types.ts:51-57` 缺失。无 codegen、无 openapi 契约测试。
- **全仓 5 处 `any` 全在 `select.tsx:24,26,31,32,35`**，且污染 10 个调用点 → 导致 `App.tsx` 8 处 `v as string` + `Recipes.tsx:129` 的 `v as RecipeKind`（把任意值断言成联合类型，最危险）。建议改泛型 `Select<T>`。

### 3.6 工程化

- **前端 Dockerfile 违反自家 engines**：`Dockerfile:1` 用 `node:20-slim`，而 `package.json:13-15` 声明 `node >=22.12` 且 vite ^8.2.2。另无 `HEALTHCHECK`（compose 里 api 有 `service_healthy`，前端反缺）、以 root 运行。
- **前端测试仅 2 个文件**（`attr-summary.test.tsx` 4 例、`primary-task.test.ts`）；`vitest.config.ts:7-12` 无 coverage/include/globals。零覆盖：`api.ts` 错误分支、路由解析、竞态、重复请求、DataTable 三态、SearchForm 校验、SegmentTabs 键盘、6 个 Dialog 流程。
- **`vite.config.ts` 全文 14 行，无 `server.proxy`** → `npm run dev` 调 `/api` 必 404，**前端无法独立开发**（这解释了 `README.md` 为何仍是未改动的 Vite 模板）。
- **`.oxlintrc.json` 仅 8 行 2 条规则**；`frontend/README.md:14-30` 自己建议开 typeAware + oxlint-tsgolint 但未开；无任何 a11y 规则。
- **无代码分割**：`App.tsx:13-14` 静态导入 Recipes/Dashboard，`vite.config.ts` 无 `manualChunks`，全仓无 `React.lazy`/`Suspense`/`ErrorBoundary` → **任何渲染异常白屏**。
- **`motion ^12.43.0` 依赖偏重**（约 30-40KB gzip）却仅用于 `segment-tabs.tsx:2,62-68` 一个滑块动画（`tabs.tsx:4` 也有引用但 `tabs.tsx` 是死代码）→ 可换纯 CSS transform。
- **分页接口齐全但从未接通**：`data-table.tsx:204-228` 分页条要求 `total>0`，而 `App.tsx:645-668` / `Recipes.tsx:103-115` 都不传 `onPageChange`/`total`（默认 0）→ **分页 UI 恒不渲染**；`App.tsx:377` 也不传 `limit`（`api.ts:16` 支持）→ 列表拉全量。
- **上传体积检查形同虚设**：`assets.py:107-112` 先 `copyfileobj` 把整个 body 落盘，**之后**才判断 `size > MAX_UPLOAD_BYTES`；而 Starlette 在进入 handler 前已把整个 multipart 落盘 → 100GB body 仍可先占满磁盘。需前置拦截（如 nginx `client_max_body_size` 已在，但 api 直连 8001 时无防护）。
- **密钥硬编码默认值**：`config.py:5-13`（DB 密码 `contenthub`、MinIO `contenthub123`），且明文重现于 `docker-compose.yml`；无生产启动校验。虽 `.gitignore` 正确忽略了 `.env`、git 历史中也**从未出现过 `.env`**（已查证），但缺 `.env.example` 而 README 又引导用户创建 `backend/.env`。
- **后端依赖未锁定**：`pyproject.toml:6-22` 全区间、无 lock 文件、无漏洞扫描；`playwright>=1.45`（捆绑 Chromium）、`pillow>=10,<12` 为高危面。
- **500 完全不可观测**：全仓 grep `logging|logger` 在 `app/` 下 **零命中**；三种错误响应形态并存（`{"detail":"中文"}`／Pydantic 的 `{"detail":[...]}`／裸 `Internal Server Error`），无 request-id。

### 3.7 a11y / UX

- **列表行键盘不可达**：`standard-list-page.tsx:158` 行点击仅 `onClick + cursor-pointer`，无 `role`/`tabIndex`/`onKeyDown`（缓解项：`App.tsx:476-477` 有「查看」按钮作备用路径）。
- **详情页缺 loading 态**：`App.tsx:395-400` 的 `openDetail` 在 `await` 前零反馈（大 `text_content` 时用户会重复点击）。且 **`DetailPageLayout` 已完整实现 loading/error/empty 三态**（`detail-page-layout.tsx:93-139`），却被 `App.tsx:720` 的 `{detail && ...}` **永久屏蔽**。
- **`SegmentTabsA` 的 ARIA 半成品**：`segment-tabs.tsx:36-39` 方向键只移焦点不改选中但无 `aria-orientation`；`:34` Enter/Space 未 `preventDefault`（Space 滚页）；`getSegmentAriaIds` 返回的 `panelId`（`:81-86`）**从未使用**，无 `aria-controls`/`tabpanel`；`:44` 的 `aria-label="Segment A"` 硬编码。
- **`info-field.tsx:108` 用 `<label>` 包裹非表单展示内容**（无关联控件，语义错误）→ 建议改 `<dt>/<dd>`；`:117` 的 `copyable` 把 `onClick` 挂在 `div` 上同样键盘不可达。
- **8 处 `style={{color:"crimson"}}` 裸 CSS 色**（`App.tsx:688,937,980,1010,1047,1083,1151` + `Recipes.tsx:143`）→ 不走 token、不随暗色主题变。建议抽 `<FieldError role="alert" className="text-sm text-destructive">`。
- **字体 token 是空头支票**：`tokens-typography.css:5-6` 声明 `'Noto Sans SC'`/`'JetBrains Mono'`，但 `public/` 只有 `favicon.svg`、全仓无 `@font-face` → 字体永远加载不到。
- 残留：`dialog.tsx:71` sr-only 文案 `"Close"` 英文（中文应用）；`dashboard.tsx:105-107` Space 未 `preventDefault`；`topbar.tsx:74-87` 健康点无 `role="status"`/`aria-live`。

### 3.8 业务逻辑硬编码违背自家设计

**证据（已亲自验证）**：`types.ts:86-87` 白纸黑字写明「平台常量（发布页 URL / 封面规格 / 音色）**不再前端硬编码**：运行时经 `GET /api/meta/platforms` 获取」。

但 `App.tsx` 仍在写死：
- `:498` `{["微信公众号","抖音","微信视频号","哔哩哔哩","官网"].map(...)}`
- `:297` / `:347` / `:352` 写死 `"微信公众号"`
- `:312` / `:369` 写死 `"晓晓（女）"`

而 `coverPlatforms`（`:416`）与 `platformMeta.voices`（`:418`）就在同文件已可用。

**已确认的真实 bug**：`App.tsx:347` 的 `dvPlatform` 初值 `"微信公众号"`，而 `:295-296` 的注释自认「历史默认「微信公众号」不在 cover 词表」—— 用户不改平台直接派生就会被后端 422 拒绝。**同一 bug 只在 `rcPlatform`（`:297`）上修过，`dvPlatform` 漏了**。

### 3.9 性能（前端）

- **巨型组件导致「打字即全表重渲染」**：`Assets` 持有全部 Dialog 输入态，敲 `rcTitle`（`App.tsx:931`）→ 整个 `Assets` 重跑 → `App.tsx:434-483` 重建 columns + 12 个闭包 → `DataTable`（未被 `memo`）全行 reconcile。**先做物理隔离（抽 Dialog），效果远大于加 `memo`**。
- **render-cover 每请求冷启动 Chromium**（`rendering.py:21-32`）：同步路由 + 默认 threadpool 40 → 最多 40 个浏览器并发 ≈ 6GB 内存。需信号量 + 浏览器复用。
- **video-kit 内存峰值三份**：`speech.py:19` bytearray + `assets.py:601-603` BytesIO + `:615` `buf.getvalue()`，且对已压缩的 mp3 还用 `ZIP_DEFLATED`。
- **LLM 提示词无长度上限**：`assets.py:530-533` 可灌 50MB 正文进上游。

### 3.10 测试盲区（高价值）

- **`conftest.py:66-67` 用 `Base.metadata.create_all` 建表** → `2d5364b7040d:39-46`、`a98ff6f65060:24-27` 两个 `alter_column` 与 `c3d9f1a02b47:25-40` 的手写枚举 + 数据迁移**从未被执行**；`test_models.py:91,105` 的 tzinfo 断言只验证 `models.py` 声明。→ **写错迁移可本地全绿、生产炸**。这是最大盲区。
- `conftest.py:34-59` 在**模块导入期**连真实 PG，无库即 collection 崩溃，连 `test_subtitles.py`/`test_media_attrs.py` 这类纯函数测试也跑不了。
- 缺 `pytest-cov`。
- **零覆盖的高危路径**：`spec={"width":{}}`、超大尺寸、`q="%"`、>2GB 413、超长/含 `/` 文件名、`storage.put` 抛异常、`commit` 抛异常、LLM `choices: []`、非 MASTER 调 derive-*、列表响应是否含 `text_content`、迁移 up/down 往返、无 API Key 的 401（加鉴权后）。
- `test_llm.py:24-29` 注释说「断言 payload 结构」，实际只断言了 `llm.url` 一个字符串。

### 3.11 已确认无安全风险（避免误报）

为免过度修复，以下经核查**确认无问题**：
- **无 SQL 注入**：全部走 SQLAlchemy 表达式；迁移 `op.execute` 用字面量。
- **无命令注入**：`media_attrs.py:49-54` 用 list 形式 `subprocess.run`、无 `shell=True`、path 来自 `mkstemp`。
- **`AssetExternalCreate.source_url` 无 SSRF**：`schemas.py:83` 用 `HttpUrl` 类型约束，且**后端从不回取该 URL**。
- **`title`/`text_content` 搜索已有 trgm 索引**，无需优化。
- **迁移与模型无漂移**（逐项核对）。
- **`.env` 从未进入 git 历史**；`.gitignore` 配置正确。

---

## 四、优化建议（按性价比排序）

### TOP 10 清单

| # | 修复项 | 证据 | 改动量 |
|---|---|---|---|
| 1 | **加日志 + 全局异常处理器 + request-id** | `main.py` 全文件、`app/` 无 logging | 1 文件 ~20 行 |
| 2 | **上传链路 `async def`→`def`（threadpool）+ 缩短事务 + `pool_size=20`** | `assets.py:148/320/371`、`:170-182`、`db.py:11` | 3 处签名 + 4 行 |
| 3 | **`spec` 用 Pydantic 校验并限幅 64–8192** | `assets.py:468-474`、`cover_specs.py:36-39` | ~15 行 |
| 4 | **列表 DTO 去 `text_content` + 返回 `total`** | `schemas.py:52`、`assets.py:202-228` | 新增 DTO |
| 5 | **写接口加 `X-API-Key` + 模板端点限管理员** | 全站无鉴权、`recipes.py:22` | 1 新文件 ~30 行 |
| 6 | **补索引（`derivations.derived_asset_id`、`assets.zone/status/updated_at`）+ `selectinload`** | `models.py:140-142`、`assets.py:234-237` | 1 迁移 |
| 7 | **上传前置体积拦截 + `safe_file_name()`** | `assets.py:107-112/160-172` | 中间件 + 工具函数 |
| 8 | **测试改跑 `alembic upgrade head` + 漂移检测 + `pytest-cov`** | `conftest.py:66-67` | 1 新测试文件 |
| 9 | **抽 `_persist_derived`/`_detail` 消 5 处重复** | `assets.py:340/386/495/545/607` | ~80 行重构 |
| 10 | **配置治理：去默认密码 + prod 启动校验 + MinIO 公网 endpoint/TLS** | `config.py:5-13`、`storage.py:24/51-55` | config+storage |

### 前端 TOP 10

| # | 修复项 | 证据 | 改动量 |
|---|---|---|---|
| 1 | **开 `strict: true` + typecheck/lint 接进 preflight** | `tsconfig.app.json:2-27`、`Makefile:11-15` | 2 行 + 2 行 |
| 2 | **删 `App.tsx:409-414` 的 `[assets]` effect，14 个变更点改 `reloadDetail()`** | `App.tsx:409-414` 及 14 处 | ~30 行 |
| 3 | **列表竞态防护 + 6 处 `String(e)` → `toErrorMessage` + `api.ts` 统一 `errDetail`** | `App.tsx:375-382`、`api.ts` 全文 | ~40 行 |
| 4 | **拆分 App.tsx：6 个 Dialog + 详情页抽组件 + `useDialogForm`** | `App.tsx:255-1180` | 2-3 天 |
| 5 | **路由表 + `React.lazy` + `ErrorBoundary` + 404** | `App.tsx:169-181,217-246` | 1 天 |
| 6 | **nginx 加固：SPA fallback + 600s 超时 + gzip + 缓存 + 安全头** | `nginx.conf` 全文 | 2 小时 |
| 7 | **详情 loading/error 态（复用 `DetailPageLayout`）+ 列表行键盘可达 + `FieldError`** | `App.tsx:395-400,720`、`standard-list-page.tsx:158` | 1 天 |
| 8 | **删死代码 + 干掉硬编码平台/音色** | `App.tsx:297/347/352/498`、`types.ts:86` | 0.5 天 |
| 9 | **Docker `node:22-slim` + `HEALTHCHECK`；oxlint 开 typeAware+jsx-a11y+no-explicit-any；vite dev proxy** | `Dockerfile:1`、`package.json:13-15`、`vite.config.ts` | 2 小时 |
| 10 | **测试补齐：3 个防回归用例 + coverage 门槛 + `user-event`** | 仅 2 个测试文件 | 1 天 |

### 执行路径建议

**并行无关项**：后端 #1/#3/#5/#7 与前端 #6/#9 都是低成本纯配置/局部改动，可随时插入；前端 #1 独立推进避免与 #4 冲突。

**严格串行**：前端 #4（拆 App.tsx）→ #5（路由表 + lazy）→ #7（三态），应在**同一迭代内完成**，否则中间态会造成二次返工。

**明确不要现在做**：
- 不要立刻引入 repository/UoW 模式或大改 `store_upload` 结构 —— 先做后端 #1–#3，再落 #8，然后才谈 #9 的分层重构。
- 不要引入 react-router（仅 3 个目的地）或 redux/zustand（2 层 prop 传递不算 drilling）。
- 不要引入 React Query 作为「为了用而用」—— 但它确实能一并修掉竞态 + 重复请求 + stats 不刷新三个问题，属于值得引入。

---

## 五、仓库治理层面的建议

### 5.1 文档体量已超过代码的一半，存在过度治理风险

`docs/` + `plans/` 合计 **5016 行**，而全部代码 10527 行 —— 文档:代码 ≈ **1:2**。其中：
- `plans/2026-09-04-m0-asset-foundation.md` **单文件 2243 行**（占全部文档 45%）；
- `plans/2026-09-04-m1-recipe-engine.md` 869 行；
- `docs/` 下实际只有 10 篇、799 行，而 `plans/` 12 篇 4217 行。

**矛盾点**：`CLAUDE.md` 明确要求「过程性/被替代文档直接删除，git 历史即档案馆，不设归档目录」，且 `FND-GOV-001 §6` 定义治理三原则含「git 即档案馆」。但 `plans/` 目录本身就是一个**例外于该规则的过程文档归档区**，且已积累 12 个里程碑的过程稿。M0 计划 2243 行显然是「一路追加」的结果，而非「已完成即蒸馏进 KNW」。

**建议**：把已完结里程碑的 `plans/` 文档按自家规则「蒸馏结论进 `docs/knowledge/` 或 `docs/product/`，然后删除」。保留 git 历史即可回溯。这既符合自家治理规范，也能显著降低维护负担。

**正面**：`docstd`（374 行，无第三方依赖）实现了编号分配/校验/索引重建，`pre-commit` 仅对 `docs/*.md` 做检查且可一键关闭 —— 这个设计权衡（单人项目不引入 CI）是清醒的。

### 5.2 「无 CI」决策需配套更强的前置门禁

`CLAUDE.md` 明确声明「不上传任何 GitHub Actions，推送不会因文档/CI 被阻断，也不消耗云端算力」—— 这是**有意识的权衡**，在单人项目阶段合理，值得尊重。

但前提是 `Makefile` 的 `preflight` 必须真覆盖门禁。当前 `Makefile:11-15`：
```make
preflight:
	python3 scripts/docstd --docs ./docs check
	cd backend && .venv/bin/pytest -q
	cd backend && .venv/bin/alembic upgrade head
	cd frontend && npm test
```
**漏了前端 `tsc -b`（typecheck）与 `oxlint`（lint）** —— 而这两项恰恰是能拦住 2.7 类问题的。另 `preflight` 是手动目标，无任何东西强制它在提交前运行。

**建议**：① `preflight` 补 `npm run build`（含 `tsc -b`）与 `npm run lint`；② 把 `preflight` 挂到本地 `pre-commit`（当前只跑 docstd）。

### 5.3 仓库卫生小项

- **`feature/m6-app-shell` 分支是陈旧的**：落后 main 22 次提交、领先 0，实为已合并分支，建议删除。
- **无 LICENSE**：作为「待独立 SaaS」的产品雏形，建议尽早明确许可证（或明确标注 proprietary）。
- **无 `.env.example`**：README 引导用户创建 `backend/.env`，但没有模板。建议补上（`CH_LLM_API_KEY`、`CH_DATABASE_URL`、`CH_MINIO_*`）。
- **README 的「快速开始」与 `Makefile` 基本一致，质量不错**，但缺少：架构图、目录结构说明、API 端点清单。
- **无 tag / 无 release**：建议至少给 M0–M7 打里程碑 tag，配合 `CLAUDE.md` 要求的「task 已完成须绑定 commit hash」形成可追溯链。
- **`frontend/README.md` 仍是未改动的 Vite 模板**（`README.md:1-30` 内容为默认脚手架说明）—— 与 `frontend/COMPONENTS.md` 的存在形成反差。

### 5.4 一个值得注意的模式风险

后端 21 个测试文件全部通过，但这建立在 `create_all` 而非迁移之上；同时 `CLAUDE.md` 反复强调「任务已完成声明须绑定 commit 证据」的取证纪律。

**这两者结合会给出一致性错觉**：测试绿 + 文档严谨 → 容易高估项目健康度。而实际上认证、日志、迁移验证、前端 typecheck 四个基础门禁全部缺失。建议在下一轮迭代把「补门禁」本身当作一个里程碑（如 M8），而不是继续堆功能——考虑到当前已有 6 个 Dialog、9 个 API 端点、5 类派生任务的存量，**继续加功能会让前端 #4 的重构成本指数上升**。

---

## 附：完整后端报告

后端逐条审查（15 高 / 25 中 / 12 低，含全部代码示例）已落盘为同目录下的
`ContentHub-后端详细审查附页.md`（1193 行）。

## 附：验证命令清单

```bash
# 后端
cd backend && .venv/bin/pytest -q
cd backend && .venv/bin/alembic upgrade head && .venv/bin/alembic downgrade base
# 复现 2.5 的 spec 500（加鉴权后需带 key）
# curl -X POST .../render-cover -F 'spec={"width":{}}'   → 当前 500（TypeError）

# 前端（需先 npm ci）
cd frontend && npx tsc -b            # 开 strict 后暴露全部空值问题
cd frontend && npm run lint
cd frontend && npm test
cd frontend && npm run build && npx vite preview
```

---

*报告由三路独立审查合并：仓库横向检查 + 后端深度审查（子代理）+ 前端深度审查（子代理）。所有 `文件:行号` 证据均已抽样复核。*

---

## 变更记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-09-24 | 初版审查报告 | zhoudabo |
| 1.1 | 2026-10-27 | 收录入文档治理：编号 QA-REV-001、补 frontmatter（reviews/ → quality/） | zhoudabo |
