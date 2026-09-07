# M4 四阶段工作台（选题/素材/制作/发布）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把界面重组为用户设想的内容供应链工作台——左侧四阶段导航（素材库/选题策划/内容制作/内容发布），每阶段独立列表+详情与阶段状态机；选题立项可产出初始文稿自动入素材库；阶段间流转全部走派生血缘。

**Architecture:** 数据模型加法演进——AssetZone 新增 `topic`；status 收归各阶段词表（`ZONE_STATUSES`/`ZONE_TRANSITIONS` 按区定义）；阶段推进 = 派生（新增 topic→source 派生规则与 initial-draft 端点）；前端改为左侧导航 + 四个阶段页（App.tsx 内实现，无框架、无打磨）。存量数据迁移规则已获用户认可（选题策划目录 24 篇 → 选题区候选；其余 source → 可用）。

**Tech Stack:** 现有栈不变。前端效率优先：单文件、内联样式、粗糙可接受，打磨留待下一阶段（用户明确指示）。

## Global Constraints

- 沿用全部既有约束（依赖带上限、红线、端口、测试库隔离、Conventional Commits；后端 TDD；前端 build+部署为门禁）。
- **阶段状态词表（唯一权威，本计划定义）**：
  - `source`：`available`（可用，终态，无流转）
  - `topic`：`candidate → researching → approved`；`candidate/researching → shelved`；`shelved → candidate`（可重启）
  - `master`：`drafting ⇄ finalized`（+ 存量 `publishing/published` 只读保留，不再有 master→publishing 转换）
  - `publish`：`publishing ⇄ finalized(master 侧撤回) / → published`（沿用不变）
- **存量迁移规则（用户已认可）**：`zone=source AND source_path LIKE '选题策划/%'` → `zone='topic', status='candidate'`；其余 `zone=source` → `status='available'`；master/publish 不动。
- 阶段间流转只用派生：新增派生区规则 `(topic → source)`（初始文稿）；`initial-draft` 端点要求 topic 状态 = approved。
- 前端效率红线：**禁止**在本计划内做视觉打磨、组件库、动画、响应式；粗糙即达成。
- 任务完成声明绑定 commit（FND-GOV-001 §7）。

---

### Task 1: 阶段模型演进（模型 + 迁移 + 状态机，后端 TDD）

**Files:**
- Modify: `backend/app/models.py`（AssetZone 加 TOPIC；AssetStatus 加 `available/candidate/researching/approved/shelved`；新增 `ZONE_STATUSES: dict[AssetZone, set[AssetStatus]]` 与 `ZONE_TRANSITIONS: dict[AssetZone, dict[AssetStatus, set[AssetStatus]]]`；保留旧 `TRANSITIONS` 供兼容或删除——以 grep 结果为准，无引用则删）
- Create: `backend/alembic/versions/*_m4_topic_stage.py`
- Modify: `backend/tests/test_models.py`（阶段词表/流转表测试）
- Modify: `backend/tests/conftest.py`（TRUNCATE 不变——表未变）

**Interfaces:**
- Produces:
  - `ZONE_STATUSES = {SOURCE:{AVAILABLE}, TOPIC:{CANDIDATE,RESEARCHING,APPROVED,SHELVED}, MASTER:{DRAFTING,FINALIZED,PUBLISHING,PUBLISHED}, PUBLISH:{PUBLISHING,PUBLISHED}}`
  - `ZONE_TRANSITIONS = {TOPIC: {CANDIDATE:{RESEARCHING,SHELVED}, RESEARCHING:{APPROVED,SHELVED}, SHELVED:{CANDIDATE}, APPROVED:set()}, SOURCE: {}, MASTER: {DRAFTING:{FINALIZED}, FINALIZED:{DRAFTING}}, PUBLISH: {PUBLISHING:{PUBLISHED}}}`（注意：master 不再允许 finalized→publishing；publish 资产由派生产生即 publishing）
  - 端点 PATCH /status 改用 ZONE_TRANSITIONS 校验（非法→422 报允许值）
- 迁移要点：`ALTER TYPE assetzone ADD VALUE 'topic'`、`ALTER TYPE assetstatus ADD VALUE 'available'/'candidate'/'researching'/'approved'/'shelved'`（PG16 允许事务内 ADD VALUE，若 alembic 报错则 `op.execute("COMMIT")` 处理——以实际报错为准）；数据迁移两条 UPDATE 按全局约束规则；downgrade 对称（topic 区迁回 source/`topic`，新枚举值不删——PG 不支持安全删值，downgrade 注释说明）。

- [ ] **Step 1: 失败测试**

```python
def test_zone_vocabularies_and_transitions():
    from app.models import ZONE_STATUSES, ZONE_TRANSITIONS, AssetZone, AssetStatus
    assert ZONE_STATUSES[AssetZone.TOPIC] == {
        AssetStatus.CANDIDATE, AssetStatus.RESEARCHING,
        AssetStatus.APPROVED, AssetStatus.SHELVED}
    assert ZONE_STATUSES[AssetZone.SOURCE] == {AssetStatus.AVAILABLE}
    assert ZONE_TRANSITIONS[AssetZone.TOPIC][AssetStatus.CANDIDATE] == {
        AssetStatus.RESEARCHING, AssetStatus.SHELVED}
    assert ZONE_TRANSITIONS[AssetZone.TOPIC][AssetStatus.APPROVED] == set()
    assert ZONE_TRANSITIONS[AssetZone.MASTER][AssetStatus.DRAFTING] == {AssetStatus.FINALIZED}


def test_topic_asset_roundtrip(db_session):
    a = Asset(zone=AssetZone.TOPIC, status=AssetStatus.CANDIDATE,
              title="选题：途虎拆解", content_type="markdown")
    db_session.add(a); db_session.flush(); db_session.expire_all()
    got = db_session.get(Asset, a.id)
    assert got.zone is AssetZone.TOPIC and got.status is AssetStatus.CANDIDATE
```

- [ ] **Step 2: 实现 models.py + 迁移**；验证 `upgrade → downgrade -1 → upgrade` 循环 + 全套 `pytest -q`（86+2=88 量级）
- [ ] **Step 3: 存量迁移验证**：`docker compose exec postgres psql -U contenthub -c "SELECT zone, status, count(*) FROM assets GROUP BY 1,2 ORDER BY 1"`——预期 `topic|candidate|=选题策划目录文件数（24）`、`source|available|≈41`、master/publish 原样
- [ ] **Step 4: 提交** `git commit -m "feat: M4 阶段模型（topic 区 + 各阶段状态机 + 存量迁移）"`

---

### Task 2: 阶段 API（状态校验按区 + initial-draft 端点 + 派生规则，后端 TDD）

**Files:**
- Modify: `backend/app/routers/assets.py`：
  - `update_status` 改用 `ZONE_TRANSITIONS[asset.zone]` 校验
  - `ALLOWED_DERIVATION_ZONES` 增加 `(AssetZone.TOPIC, AssetZone.SOURCE)`
  - 新端点 `POST /api/assets/{topic_id}/initial-draft`：multipart `title`、`file`（markdown/docx）→ 201：守卫 zone=topic（422）、status=approved（422 "仅已立项选题可产出初始文稿"）；产物 source 区、status=available、content_type 按扩展名；Derivation(topic→source, note="立项初始文稿")；响应 AssetDetail
- Modify: `backend/tests/test_stage_api.py`（新建）

**Interfaces:**
- Produces: 按区状态校验；initial-draft 端点；topic→source 派生合法
- 测试：topic 候选→调研中 200 / 候选→approved 422；approved 选题 initial-draft → 201 source+血缘；非 approved → 422；source→master link 仍合法（回归）

- [ ] **Step 1: 失败测试 → 实现 → 全套通过**（88+4≈92 量级）
- [ ] **Step 2: 提交** `git commit -m "feat: M4 阶段 API（按区状态机校验 + 立项初始文稿端点）"`

---

### Task 3: 前端左侧导航与四阶段页（效率优先）

**Files:**
- Modify: `frontend/src/App.tsx`（布局重构：左导航 + 内容区；hash 路由扩展）

**行为规格（效率优先，不做视觉打磨）：**
1. 布局：`display:flex`；左导航固定 150px（列表：📚 素材库 `#/source`、📝 选题策划 `#/topic`、🎬 内容制作 `#/master`、📤 内容发布 `#/publish`、⚙️ 配方 `#/recipes`）；右侧内容区占满。`#/` 重定向到 `#/source`。
2. 阶段页 = 现 Assets 视图参数化：固定 zone（列表查询强制带 zone）、状态 chips 换成该阶段词表、上传表单仅素材库/选题策划/内容制作三页显示（发布页无上传——发布物靠派生）、详情面板沿用任务流（primaryTask 扩展 topic 分支）。
3. primaryTask/nextStepHint 增补 topic 分支：candidate→"推进到调研中"；researching→"调研充分后点「已立项」"；approved→"用「产出初始文稿」把选题落成素材"；shelved→"搁置中，可重启为候选"。
4. approved 选题详情任务区 = 「产出初始文稿」表单（标题+md/docx 文件）。
5. 详情页与列表页的关系：维持"列表在上、点击展开详情"的现有交互（效率优先，不做左右双栏内容区）。
6. 现有 #/ 路由、Assets/Recipes 组件结构尽量复用；粗糙可接受。

- [ ] **Step 1: 实现**（App.tsx 内：`STAGES` 常量驱动导航与路由；Assets 组件加 `stageZone` prop）
- [ ] **Step 2: build + 部署 + :8080 冒烟**（四导航切换、各列表 zone 正确、详情任务流按阶段变化）
- [ ] **Step 3: 提交** `git commit -m "feat: M4 四阶段工作台布局（左导航 + 阶段列表/详情）"`

---

### Task 4: 阶段任务与流转接线（前端）

**Files:**
- Modify: `frontend/src/App.tsx`、`frontend/src/api.ts`、`frontend/src/types.ts`

**行为规格：**
1. types：Zone 加 "topic"；STATUS_LABELS 补五新状态中文（可用/候选/调研中/已立项/已搁置）；TRANSITIONS 改为按区导出 `zoneTransitions(zone)`（值与后端 ZONE_TRANSITIONS 对齐）。
2. api：`initialDraft(topicId, title, file)`。
3. 选题详情任务区：按状态渲染推进按钮（候选→调研中/搁置；调研中→已立项/搁置；已立项→产出初始文稿表单；搁置→重启）。
4. 素材详情：显示"被引用下游"（现有 downstream）；source 状态无流转按钮。
5. 内容制作/发布详情：沿用 M3 任务流（primaryTask 现有分支原样）。

- [ ] **Step 1: 实现 + build + 部署 + 冒烟**（真实链路：任一 approved 选题产出初始文稿 → 素材库可见带血缘）
- [ ] **Step 2: 提交** `git commit -m "feat: M4 阶段任务接线（选题状态机 + 初始文稿产出）"`

---

### Task 5: M4 验收 + PRD 2.4

- [ ] 后端全量 + preflight；前端 build
- [ ] 真实链路验收（部分由用户执行）：①迁移结果核对（选题策划区 24 篇）②选题推进→立项→初始文稿→素材库→制作→发布走通一条新链③用户 UX 验收（导航/列表/详情）
- [ ] PRD：§5 加 M4 行（🔧 待用户 UX 验收）；version → 2.4 + 变更行；§3 核心概念模型补"四阶段与状态机"小节
- [ ] 提交 `git commit -m "docs: 新增 M4 迭代记录 (PRD-MVP-001 v2.4)"`

---

### Task 6: 终审 + 合入 main

- 全分支 review-package 终审（重点：迁移正确性、按区状态机无回归、前端重构无能力丢失）；修复；合入 main；推送；持久记忆更新

## Self-Review 记录

- **范围**：用户设想全落位（四导航/列表+详情/阶段状态机/初始文稿入素材库/血缘串联）；前端效率红线明确。✔
- **占位符扫描**：无 TBD；迁移规则、状态机词表、端点行为均已具体化。✔
- **类型一致性**：ZONE_STATUSES/ZONE_TRANSITIONS（T1）↔ 端点校验（T2）↔ 前端 zoneTransitions/STATUS_LABELS（T4）对齐。✔
- **风险**：①PG enum ADD VALUE 事务行为（PG16 应可行，备选 COMMIT 技巧已注明）②master 存量 publishing/published 状态保留为只读词表（不再产生新转换，避免破坏 14 篇已导入定稿）③前端重构碰旧交互——T3/T4 冒烟清单覆盖。
