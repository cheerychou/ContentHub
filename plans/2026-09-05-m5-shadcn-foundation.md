# M5 shadcn/ui 组件体系（自 CDD3 提取）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 CDD3 提取 shadcn/ui 规范与公共组件到 ContentHub 前端，建立系统化组件体系，并把现有界面重构到该体系上。

**Architecture:** 给 ContentHub 前端装 Tailwind v4（CSS-first，无 config 文件）→ 拷贝 CDD3 的 token CSS 产物（tokens-saas/theme-bindings/dark-layer）与 `@theme` 映射 → 按 shadcn 约定建 `src/components/ui/`（new-york + base-ui 变体）与 `@/` 别名 → 移植低耦合组件集 → App.tsx/Recipes.tsx 重构到组件体系（逻辑不变，只换呈现层）。

**Tech Stack:** 新增 tailwindcss@^4 + @tailwindcss/vite、@base-ui/react、cva、cn（npm 包，与 CDD3 同款）、@phosphor-icons/react（仅组件内部依赖时）。

**来源基准（CDD3）:** `/Users/zhoudabo/应用开发/CDD3/frontend/platform-web/`（components.json、src/index.css、src/components/ui/*、src/components/variants/*）与 `packages/shared-ui/tokens/build/css/*`、`packages/shared-ui/src/components/common/*`（PageHeader/StatusBadge/EmptyState/ErrorState）。

## Global Constraints

- 沿用全部既有约束（红线、端口、测试库隔离、Conventional Commits；前端门禁 = tsc/vite build + 部署 + :8080 200）。
- **不引入**：CDD3 的 shared-http/auth/stores/domain 枚举/sidebar 全家桶/业务卡片（深度绑定 CDD3 业务）。
- token 采用 CDD3 现成 CSS 产物（不搬 Style Dictionary 构建管线）；暗色变量随 token 带入但不接切换开关。
- **重构铁律（沿用 M3 先例）**：App.tsx/Recipes.tsx 只换呈现层（DOM 元素与 className），primaryTask/nextStepHint/表单提交逻辑/run 错误处理/ZONE_TRANSITIONS 接线逐字保留；每完成一个重构区块自查能力清单。
- 前端无测试框架（维持）；每任务门禁 = build 绿 + 部署 + :8080 200 + 关键路径 curl。
- CDD3 路径只读，绝不写回。

---

### Task 1: Tailwind v4 + shadcn 地基

**Files:**
- Modify: `frontend/package.json`、`frontend/vite.config.ts`、`frontend/tsconfig.app.json`、`frontend/src/index.css`
- Create: `frontend/components.json`、`frontend/src/lib/utils.ts`（re-export `cn` 包）、`frontend/tokens/*.css`（自 CDD3 拷贝产物）

**Steps:**
- [ ] 1. 依赖：`tailwindcss @tailwindcss/vite class-variance-authority cn @base-ui/react`（版本对齐 CDD3：tw ^4.3、base-ui ^1.7、cva ^0.7、cn ^0.2）+ dev 侧 `@types/node`（aliases 需要）；`npm install`
- [ ] 2. vite.config.ts 加 `@tailwindcss/vite` 插件 + `@` 别名（resolve.alias + tsconfig paths `@/* → ./src/*`）
- [ ] 3. 拷贝 token CSS：`tokens-saas.css`、`theme-bindings.css`、`dark-layer.css`（自 CDD3 shared-ui/tokens/build/css 与 tokens/ 目录，brand-layer 若被依赖一并拷）到 `frontend/tokens/`；重写 `src/index.css` 为 CDD3 同构（`@import 'tailwindcss'` + tokens imports + `@custom-variant dark`，`@source` 指向本项目 src）
- [ ] 4. `components.json`（style new-york、base base-ui、aliases 同 CDD3）；`src/lib/utils.ts` 导出 cn 包
- [ ] 5. 从 CDD3 拷贝首批 ui 组件（连 variants/ 约定）：button、badge、card、input、label、select、textarea、table、tabs、separator、skeleton、spinner、tooltip + status-badge、empty-state、error-state；逐个修 import（cn 来源、缺失的子组件按需补拷）
- [ ] **门禁**：`npm run build` 绿（含 Tailwind 编译）；临时在 App.tsx 顶部放一个 `<Button>` 冒烟后移除；部署 :8080 → 200
- [ ] 6. 提交 `feat: Tailwind v4 + shadcn 地基与首批组件（自 CDD3 提取）`

---

### Task 2: 业务公共组件移植

**Files:**
- Create: `frontend/src/components/common/page-header.tsx`、`status-badge.tsx`（若 Task 1 未含）、`empty-state.tsx`、`error-state.tsx`（自 CDD3 shared-ui，剥业务依赖）
- Create: `frontend/COMPONENTS.md`（规范文档：来源声明、目录约定、variants 分离约定、如何用 shadcn CLI 加新组件、本项目的 token/暗色说明）

**Steps:**
- [ ] 1. 移植上述组件（PageHeader 剥离 breadcrumb 依赖或连 breadcrumb 一并拷；StatusBadge 若依赖 CDD3 status-config 则内联一份 ContentHub 版映射）
- [ ] 2. build 绿 + 部署
- [ ] 3. 提交 `feat: 移植业务公共组件（PageHeader/StatusBadge/EmptyState/ErrorState）与组件规范文档`

---

### Task 3: 现有界面重构到组件体系（核心重构）

**Files:**
- Modify: `frontend/src/App.tsx`、`frontend/src/Recipes.tsx`

**重构规格（逐区块，逻辑逐字保留）：**
1. 页面骨架：`<main>` → PageHeader（标题 + 说明 + 流水线横条内容并入）或 Card 包裹；左右分栏布局保留（nav 用简单按钮组即可，不引 sidebar 全家桶）
2. 表单区（上传/渲染封面/文本变体/语音包/发布登记/派生发布物/补链）：Input/Label/Select/Textarea/Button 替换原生标签；按钮语义色（上传=primary、删除=destructive 变体、次要=outline）
3. 资产列表 `<table>` → ui/Table（TableHeader/TableRow/TableCell）；行点击行为不变
4. 状态呈现：ZONE/STATUS 标签 → StatusBadge 或 Badge variant 映射；chips → Button size=sm variant 切换
5. 详情面板：外框 → Card（CardHeader/CardContent）；nextStepHint → 内置 Alert 样式或保留彩色 div（二选一，Efficiency 优先）；「下一步」任务卡按钮 → Button；空列表 → EmptyState；接口错误横条 → error-state 或保留红字（Efficiency 优先）
6. Recipes 页同样替换（表格 + 表单 + kind Badge）
7. **铁律自查**：primaryTask 七键、nextStepHint、9+1 个 run() handler、pubUrl/idTitle/idFile 跨资产重置、ZONE_TRANSITIONS 接线——逐项确认未动

- [ ] 1. 分区块重构（每完成一块 build 一次）
- [ ] 2. build + 部署 + :8080 200 + curl 冒烟（四阶段页各一次）
- [ ] 3. 提交 `refactor: 界面重构到 shadcn 组件体系（逻辑不变）`

---

### Task 4: M5 验收 + PRD 2.5

- [ ] 用户 UX 验收（视觉/交互系统性提升是否成立）
- [ ] PRD：§5 表末加 M5 行（🔧 待用户验收）；version → 2.5 + 变更行；§6 补一句前端规范（shadcn/base-ui/Tailwind v4，源自 CDD3）
- [ ] 提交 `docs: 新增 M5 迭代记录 (PRD-MVP-001 v2.5)`

---

### Task 5: 终审 + 合入 main

- 全分支 review-package 终审（重点：重构无逻辑回归、组件 import 完整、token 编译产物无 CDD3 路径残留）；修复；合入 main；推送；持久记忆更新

## Self-Review 记录

- **范围**：地基（T1）→ 公共组件（T2）→ 重构（T3）→ 文档与验收（T4）→ 终审（T5）；CDD3 业务绑定件明确排除。✔
- **占位符扫描**：无 TBD；组件清单具体到文件名。✔
- **风险**：①Tailwind v4 与现有 index.css 的样式冲突（现无全局样式，冲突面小）②base-ui 组件 import 路径与 CDD3 单包结构差异（拷贝时逐个修）③App.tsx 大重构回归风险——铁律自查 + 终审重点。✔
