# M7 素材类型化属性（自动抽取 + 类型筛选 + 属性呈现）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让素材的类型属性"采得到、看得见、可补录"——上传时自动抽取（图片尺寸/格式、视频时长/分辨率、文本字数/语言），素材库加类型 Tab 与属性摘要列，详情页按类型渲染属性区并支持人工补录。

**Architecture:** 属性存入 `asset.meta["attrs"]`（JSONB 命名空间，免迁移）；抽取模块 `media_attrs.py` 单一接缝（image 用 Pillow、video/audio 用 ffprobe 子进程、text 纯函数）；列表接口支持 content_type 多值过滤（逗号分隔）；素材库页加类型 Tab + 「属性」摘要列；详情加「类型属性」DetailSection + 补录 Dialog（PATCH attrs 合并）。已获用户认可：不拆二级菜单，用类型筛选 + 属性摘要达成快速查找。

**Tech Stack:** 新增 pillow（>=10,<12）、系统依赖 ffmpeg（backend Dockerfile apt 安装；本机 brew 已装）。

## Global Constraints

- 沿用全部既有约束；重构铁律照旧（本里程碑前端改动集中于素材库页与详情属性区）。
- **meta.attrs 键规范（唯一权威）**：image → `{format, width, height}`；video → `{format, duration_seconds, width, height}`；audio → `{duration_seconds}`；markdown/docx → `{word_count, language}`（language: zh/en/mixed/other）；人工补录键：`author`、`language`、`has_subtitle`、`color_mode` 及任意自定义键。attrs 与既有 meta 键（kind/platform/recipe_id…）互不覆盖（深合并保留原键）。
- ffprobe 仅在 `media_attrs.py` 内以 subprocess 调用（单一接缝，测试注入假实现）；失败静默（attrs 缺失不阻断上传）。
- 大文件（>50MB 走 spool）同样抽取视频/音频属性（ffprobe 读 spool 落地的临时文件）。
- 存量回填脚本 dry-run 默认；幂等（已有 attrs 的资产跳过，`--force` 重算）。
- 列表类型 Tab 词表：全部 / 文章(markdown+docx) / 图片(image) / 视频(video) / 音频(audio) / 链接(link)；后端 content_type 参数支持逗号分隔多值。

---

### Task 1: 抽取模块 + 上传接入（后端 TDD）

**Files:**
- Modify: `backend/pyproject.toml`（pillow>=10,<12）、`backend/Dockerfile`（ffmpeg：`RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*`）
- Create: `backend/app/media_attrs.py`（`image_attrs(data)->dict|None`、`av_attrs(data, kind)->dict|None`（临时文件→ffprobe -print_format json）、`text_attrs(text)->dict`、`extract_attrs(content_type, *, data=None, text=None, tmp_path=None)->dict`）
- Modify: `backend/app/routers/assets.py`（store_upload 小/大两路径接入：image→Pillow；markdown/docx→text_attrs(text_content)；video/audio→对临时文件 av_attrs；结果写入 `asset.meta["attrs"]`，与既有 meta 深合并）
- Modify: `backend/tests/test_media_attrs.py`（新建）

**Interfaces:**
- Produces: 上传图片 → meta.attrs={format,width,height}；上传 md/docx → {word_count,language}；视频/音频 → duration/尺寸（真实 ffprobe）；解析失败 → attrs 缺失不报错
- 测试：①真 PNG 字节（1×1 红点 base64，同 M2 冒烟）断言 format/width/height；②text_attrs 中/英/混合；③ffprobe 解析器喂 canned JSON（subprocess monkeypatch）；④上传接入 e2e（PNG → 201 且 meta.attrs.width==1）

- [ ] Step 1: 失败测试 → 实现 → 全套 `pytest -q`（97+4≈101 量级，0 warnings）
- [ ] Step 2: Dockerfile 加 ffmpeg；`docker compose build api` 成功（网络失败则重试/记录）
- [ ] Step 3: 真实冒烟：上传真 PNG 断言 attrs；上传 .md 断言 word_count
- [ ] Step 4: 提交 `feat: M7 素材类型属性自动抽取（图片/文本/音视频）`

---

### Task 2: 存量回填脚本 + attrs 补录端点（后端 TDD）

**Files:**
- Create: `backend/scripts/backfill_attrs.py`（dry-run 默认/--apply/--force；遍历有 object_key 且 content_type ∈ image/video/audio 或有 text_content 的资产：从 storage 取字节跑 extract_attrs，合并入 meta.attrs；幂等——已有 attrs 且非 --force 跳过）
- Modify: `backend/app/routers/assets.py`（PATCH /api/assets/{id}/attrs：JSON `{attrs: {...}}` 深合并入 meta.attrs（人工键不覆盖自动键除非显式同名？规则：**补录键与自动键冲突时以补录为准**——用户人工输入优先），响应 AssetOut）
- Modify: `backend/tests/test_backfill_attrs.py`、`test_assets_api.py`（attrs PATCH 用例）

**Interfaces:**
- `python -m scripts.backfill_attrs [--apply] [--force]`；Makefile 目标 `backfill-attrs FILTER ?= --dry-run`
- `PATCH /api/assets/{id}/attrs` → 200 AssetOut；404/422（attrs 非对象）
- [ ] Step 1: TDD → 实现；存量 dry-run 报告（预期：38 source 中 9 图片可回填尺寸、md 可回字数；master 同理——以实际输出为准）
- [ ] Step 2: 全套通过 + 提交 `feat: M7 存量属性回填脚本与人工补录端点`

---

### Task 3: 素材库类型 Tab + 属性摘要列（后端 TDD + 前端）

**Files:**
- Modify: `backend/app/routers/assets.py`（list_assets 加 `content_type` 参数，逗号分隔多值过滤；测试）
- Modify: `frontend/src/api.ts`（listAssets 参数加 content_type）、`frontend/src/App.tsx`（素材库页：类型 Tab（SegmentTabs 复用：全部/文章/图片/视频/音频/链接）+「属性」摘要列 + 上传 Dialog 后提示含抽取结果？——保持轻量：仅列表列）
- Modify: `frontend/src/components/common/` 如需（attrs 摘要渲染小组件 `attr-summary.tsx`）

**Interfaces:**
- 摘要渲染规则：image → `{width}×{height} · {format}`；video → `{mm:ss} · {format}`；audio → `时长 {mm:ss}`；markdown/docx → `{word_count} 字`；无 attrs → "—"
- [ ] Step 1: 后端多值过滤 TDD（content_type=markdown,docx 命中两类）→ 实现
- [ ] Step 2: 前端 Tab + 摘要列；build + 部署 + 冒烟（Tab 过滤请求数、摘要列渲染）
- [ ] Step 3: 提交 `feat: M7 素材库类型筛选与属性摘要列`

---

### Task 4: 详情类型属性区 + 补录 Dialog

**Files:**
- Modify: `frontend/src/App.tsx`（详情加「类型属性」DetailSection：按 content_type 渲染 attrs InfoFields + 补录按钮；补录 Dialog：作者/语言/字幕(视频)/色彩模式(图片)/自由键值——提交 PATCH attrs）

**行为规格：**
1. 属性区仅 image/video/audio/markdown/docx 显示；attrs 为空显示"暂无属性（上传时自动抽取）"
2. 补录 Dialog 字段按类型预置 + 自定义键值对（可加多行）；提交调 PATCH attrs；失败错误显示在 Dialog 内（沿用 dialogError 模式）
- [ ] Step 1: 实现 + build + 部署 + 冒烟（补录 author → 详情立现）
- [ ] Step 2: 提交 `feat: M7 详情类型属性区与人工补录`

---

### Task 5: M7 验收 + PRD 2.8

- [ ] 用户 UX 验收（类型 Tab/摘要列/详情属性/补录）
- [ ] PRD：§2 加 M7 行（🔧 待用户验收）；§3.2 模板与提示词库之后补「素材类型属性」说明；version → 2.8 + 变更行
- [ ] 提交 `docs: 新增 M7 迭代记录 (PRD-MVP-001 v2.8)`

---

### Task 6: 终审 + 合入 main

- 全分支 review-package 终审（重点：抽取失败不阻断上传、attrs 合并不丢键、回填幂等）；修复；合入 main；推送；持久记忆更新

## Self-Review 记录

- **范围**：用户认可的三层方案（采集/筛选+摘要/详情+补录）全落位；二级菜单不做（已论证）。✔
- **占位符扫描**：attrs 键规范逐一列出；Tab 词表具体。✔
- **风险**：①ffprobe 容器依赖（Dockerfile 装 ffmpeg，网络失败重试）②大视频抽取耗时（ffprobe 只读 metadata，秒级）③attrs 深合并丢键风险——测试锁定"既有 meta 键保留"。✔
