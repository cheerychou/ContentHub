# 列表列结构调整（首列编号 + 末列操作）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四阶段列表列结构调整对齐 CDD3 管理页范式：首列「编号」（短 ID + 更新时间两行，短 ID 点击复制完整编号），末列「操作」（查看 + 复制）。验收走查期反馈驱动的小迭代。

**用户决策（2026-09-10 讨论定稿）:**
1. 编号走方案 A：短 ID（UUID 前 8 位）展示；不加业务编号字段、后端零改动（方案 B 业务编号若未来要做，另行入 PRD 排 M8+）。
2. **不做**「用途」列（数据模型无该字段，不加新字段）；名称列第二行的文件名/类型辅助信息维持现状。
3. 操作列轻量版：仅「查看」（与行点击同效，滚到页内详情面板）+「复制」（复制完整 UUID）两个稳定动作；**主任务动作（定稿/渲染封面/语音包/发布登记）不进列表**——M3 核心设计是任务唯一在详情面板任务区展开。
4. 「查看」暂为页内详情面板（现状行为）；M8 深链路由落地后升级为真路由跳转。

## Global Constraints

- 纯前端改动：后端、API 契约、依赖零改动；不新建组件文件（复制逻辑沿用 `info-field.tsx` 的 `navigator.clipboard.writeText` + try/catch 内联模式，YAGNI）。
- 四区共用同一 `columns` 定义（App.tsx 单份），改一处全生效；属性列的 zone 条件（topic 区不显示）保持不变。
- 操作列与首列短 ID 的点击必须 `e.stopPropagation()`，不得触发行点击（避免双开详情）。
- 复制反馈沿用 InfoField 既有行为：静默复制 + `title` 提示文案，无 toast（若用户验收要求反馈再议）。
- 重构铁律照旧：除 onRowClick 内联回调提取为具名函数外，任何任务/提交/详情逻辑零改动。
- 质量门禁：`frontend` 下 `npm run build`（tsc -b）与 `npm run lint`（oxlint）零错误；`make preflight` 全绿（前端无测试 runner，验证靠编译+门禁+人工冒烟）。

---

### Task 1: 列表首列编号化 + 末列操作列（前端）

**Files:**
- Modify: `frontend/src/App.tsx`（columns 定义 ~L446-471；onRowClick 内联回调 ~L654-659）

**Interfaces:**
- Produces: 四区列表首列显示 `a.id.slice(0, 8)`（font-mono）+ 更新时间两行；末列「查看」「复制」两按钮；行点击与「查看」等效打开页内详情面板。
- 点击隔离：首列 ID 点击、操作列两按钮点击均不触发行点击。

**Steps:**
- [ ] Step 1: 把 StagePage 的 `onRowClick` 内联 async 函数（getAsset→setDetail→重置 pubUrl/idTitle/idFile）提取为具名函数（如 `openDetail(a: Asset)`），行点击与操作列「查看」共用，逻辑逐字不变
- [ ] Step 2: columns 数组改为：`{ key:"id", title:"编号", width:"w-28" }`（render：上行短 ID `a.id.slice(0,8)`，`font-mono text-sm cursor-pointer hover:text-primary transition-colors`，`title="点击复制完整编号"`，onClick stopPropagation + 复制 `a.id`；下行 `a.updated_at.slice(0,10)`，`text-xs text-muted-foreground`）→ `{ key:"title", title:"名称" }`（现 render 不动）→ 状态列不动 → 属性列不动（zone 条件不动）→ `{ key:"actions", title:"操作", width:"w-36" }`（render：`ghost` `size="sm"` 两 Button，均 stopPropagation：「查看」→ `openDetail(a)`；「复制」→ 复制 `a.id`）
- [ ] Step 3: `npm run build` + `npm run lint` 零错误；`make preflight` 全绿
- [ ] Step 4: 提交 `feat: 列表首列编号化与末列操作列（短ID复制/查看）`
