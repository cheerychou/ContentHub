# M3 UI 工作流升级 + docx 支持 + 工程清偿 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把详情面板从"能力平铺"重构为"状态驱动的任务流"视图（定稿的文章默认展开文本变体、图片母版默认展开渲染封面、低频操作折叠），支持 docx 上传抽取正文，清偿终审遗留小项。

**Architecture:** 前端无测试框架（维持现状，YAGNI）——前端任务以行为规格 + 构建通过 + 用户验收为准；后端任务照旧 TDD。重构不换框架、不引组件库，仍为 App.tsx 单页 + 内联样式。

**Tech Stack:** 新增 python-docx（>=1.1,<2.0）。

## Global Constraints

- 沿用全部既有约束（依赖带上限、红线、端口、测试库隔离、Conventional Commits；后端 TDD）。
- 详情面板信息架构（T2 的验收基准）：
  - **任务区（主区，按类型+状态默认展开恰好一个主任务）**：master+text+drafting → 「定稿」引导；master+text+finalized → 「文本变体」；master+image+finalized → 「渲染封面」；publish+markdown → 「生成视频语音包」；publish+publishing（非 markdown）→ 「发布登记」；video_kit → 下载 CTA；source 或其他 → 无主任务，仅显示指引。
  - **更多操作（`<details>` 默认折叠）**：手动状态流转、派生发布物、补链、删除。
  - 血缘（上游/下游）保持独立小节可见；上传/搜索区不动；顶部流程横条与 nextStepHint 保留。
- docx 支持口径：扩展名 `.docx` → content_type `docx`；上传时抽正文（python-docx 全部段落 join，≤50MB 走内存路径）；文本变体/语音包链路与 markdown 完全同权。
- 范围外：组件库、向导弹窗、渲染并发优化、CDD3、协作 UI（维持触发制）。

---

### Task 1: docx 正文抽取（后端 TDD）

**Files:**
- Modify: `backend/pyproject.toml`（`"python-docx>=1.1,<2.0"`）
- Modify: `backend/app/routers/assets.py`（EXT_CONTENT_TYPE 加 `.docx: "docx"`；create_asset 抽取分支）
- Create: `backend/app/docx_text.py`（`extract_text(data: bytes) -> str`：io.BytesIO → Document → `\n`.join(p.text for p in paragraphs if p.text.strip())；单一接缝，测试 monkeypatch 或直接用 python-docx 现场构造 docx）
- Modify: `backend/tests/test_assets_api.py`（追加用例）
- Modify: `frontend/src/App.tsx`（upload 解锁提示映射加 docx 分支："定稿后可生成文本变体，派生口播稿后可出语音包"——与 markdown 同文案）

**Interfaces:**
- Produces: docx 上传 → 201、content_type="docx"、text_content=抽取正文；derive-text/derive-video-kit 对 docx 资产与 markdown 同样工作（它们的守卫只看 text_content，无需改动——在测试中验证）

- [ ] **Step 1: 失败测试**

```python
def test_upload_docx_extracts_text(client):
    from io import BytesIO
    from docx import Document
    buf = BytesIO()
    doc = Document()
    doc.add_paragraph("第一段：途虎学什么。")
    doc.add_paragraph("第二段：供应链视角。")
    doc.save(buf)
    resp = client.post(
        "/api/assets", data={"zone": "master", "title": "Word 稿"},
        files={"file": ("途虎.docx", buf.getvalue(),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["content_type"] == "docx"
    assert "第二段：供应链视角。" in body["text_content"]
```

- [ ] **Step 2: 实现**（docx_text.py + 路由分支：`elif ct == "docx": asset.text_content = docx_text.extract_text(data)`——放在 markdown 分支旁，同受 INLINE_TEXT_LIMIT 约束）

- [ ] **Step 3: 全套通过**（85+1=86 量级）；提交 `git commit -m "feat: docx 上传正文抽取，Word 稿接入文本变体链路"`

---

### Task 2: 详情面板任务流重构（前端核心）

**Files:**
- Modify: `frontend/src/App.tsx`（详情面板区域重组；新增 `Section` 小组件与展开逻辑）

**行为规格（验收基准）：**
1. 面板顺序：标题 → 下一步指引（现有）→ **任务区（主表单，唯一默认展开）** → 血缘 → **更多操作（`<details>` 折叠）**。
2. 主任务选择函数（纯函数 `primaryTask(d: AssetDetail): string | null`，返回键）：
   - `master_text_drafting`（master、非 image、topic/drafting）→ 任务 = 定稿引导卡（大按钮调 patchStatus(d.id,"finalized")，附一句"定稿后解锁文本变体与语音包"）
   - `master_text_finalized` → 文本变体表单（现有逻辑迁入）
   - `master_image_finalized` → 渲染封面表单（迁入；image+drafting 状态也给渲染入口但提示先定稿）
   - `publish_markdown` → 生成视频语音包表单（迁入）
   - `publish_publishing`（非 markdown）→ 发布登记表单（迁入；含平台外链）
   - `video_kit` → 下载 CTA 大按钮（现有下载链接强化）
   - 其余（source、published、publishing 的 markdown、image 的 publishing 等）→ null（只显示指引与血缘）
3. 非主任务的能力**不删除**：全部移入「更多操作」`<details>`（手动状态流转按钮组、派生发布物、补链、删除资产）。video_kit 的下载同时保留在文件链接处。
4. 各表单现有提交逻辑/错误处理（run 助手）原样保留，只移动 DOM 位置。

- [ ] **Step 1: 实现**（先写 `primaryTask` 纯函数与 `TaskSection` 渲染，再逐块迁移现有表单 DOM；不改任何 api.ts 调用）
- [ ] **Step 2: `npm run build` 通过 + `docker compose up -d --build frontend`**
- [ ] **Step 3: 冒烟**（curl 确认 :8080 200；交互验收留给用户）
- [ ] **Step 4: 提交** `git commit -m "feat: 详情面板重构为状态驱动任务流（主任务默认展开，低频操作折叠）"`

---

### Task 3: 列表状态快捷筛选（前端）

**Files:**
- Modify: `frontend/src/App.tsx`（搜索区下加状态 chips 行）

**行为规格：** 一行圆角 chips：全部 / 选题 / 创作中 / 定稿 / 发布中 / 已发布——点击即按状态过滤列表（复用现有 listAssets 的 status 参数；与区域下拉可叠加；激活 chip 高亮）。样式与现有内联风格一致。

- [ ] **Step 1: 实现 + build + 部署**
- [ ] **Step 2: 提交** `git commit -m "feat: 列表状态快捷筛选 chips"`

---

### Task 4: 工程小清偿（后端 TDD + 前端）

**Files:**
- Modify: `backend/app/routers/assets.py`（derive-text 两处 httpx except 合并为 `except httpx.TransportError → 502`）
- Modify: `backend/app/subtitles.py`（删生产死代码 `split_sentences`；`_plain_len`/`SENT_END`/`CLAUSE` 若仅其使用一并清理；保留 `split_text`/`align_timestamps`/`to_srt`/`_ts`）
- Modify: `backend/tests/test_subtitles.py`（删除 split_sentences 相关用例，确认其余仍绿）
- Modify: `frontend/src/App.tsx`（删 `PLATFORMS_FALLBACK`，改为 meta 缺失时隐藏平台下拉并显示"平台列表加载中/不可用"提示；upload 解锁映射加 docx——若 T1 未覆盖）

- [ ] **Step 1: TransportError 改造配测试**（现测试改参数化为 TransportError 一个用例即可，ConnectError 是其子类）
- [ ] **Step 2: 死代码删除后全套通过**（86±，0 warnings）
- [ ] **Step 3: 前端 build + 部署**
- [ ] **Step 4: 提交** `git commit -m "fix: 工程清偿（TransportError 统一、死代码删除、FALLBACK 残留移除）"`

---

### Task 5: 验收 + PRD 2.3

- [ ] 用户 UX 验收（由用户执行）：Word 稿上传 → 文本变体；详情面板任务流跟手性；状态 chips
- [ ] **PRD**：§5 表末加行 `| M3（MVP 后第一迭代） | UI 状态驱动任务流 + docx 支持 + 工程清偿 → ✅ 已完成 | commit: <HEAD> · <日期>（用户 UX 验收通过后回填） |`；version → 2.3 + 变更记录行
- [ ] 提交 `git commit -m "docs: M3 验收通过并绑定证据 (PRD-MVP-001)"`

---

### Task 6: 终审 + 合入 main

- 全分支 review-package 终审（ledger triage）；修复；合入 main；推送；持久记忆更新

## Self-Review 记录

- **范围**：UI 工作流（T2/T3）= 用户选定方向；docx（T1）= 已确认的工作流缺口；清偿（T4）= 终审遗留。CDD3/协作/渲染并发维持触发制。✔
- **占位符扫描**：T2 为行为规格型任务（前端无测试框架，规格即验收基准），关键函数 `primaryTask` 给出完整键表；无 TBD。✔
- **类型一致性**：docx 的 content_type 值在后端判定/前端提示/元信息展示三处一致（"docx"）；primaryTask 键与面板区块一一对应。✔
- **风险**：详情面板 DOM 迁移可能碰坏现有提交逻辑——规格明确"只移动位置不改调用"，终审重点检查。
