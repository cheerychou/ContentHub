# 前端加固（暗色 FOUC 修复 + FE 测试 runner）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两件不依赖验收反馈、不影响走查界面行为的小加固：① 消除暗色用户刷新时的首帧闪白（FOUC）；② 搭起前端测试 runner（vitest）并接入 `make preflight` 质量门禁，补首批纯函数/组件测试。

**背景:** 暗色机制在 `frontend/src/components/layout/topbar.tsx`（THEME_KEY=`ch-theme`，切换写 `<html>.classList` + localStorage）；初始主题只在 React 挂载后的 effect 里应用，暗色用户刷新时先渲染浅色再变暗 → 闪白。前端无测试 runner（package.json 仅 dev/build/lint），`make preflight` 目前为 docstd + pytest + alembic 三步。

## Global Constraints

- 零业务逻辑改动：FOUC 修复只加首帧前的内联脚本；`primaryTask` 迁移为**逐字移动**（不改判断逻辑）。
- FOUC 内联脚本必须与 topbar.tsx 现有语义**完全一致**：只认 `localStorage["ch-theme"] === "dark"`，默认浅色（**不**引入 prefers-color-scheme 新行为）；localStorage 访问包 try/catch（隐私模式防抛错）。
- 测试一律**显式 import**（`import { describe, it, expect } from "vitest"`），不用 globals——保证 `tsc -b`（npm run build）无需改 tsconfig 即可通过。
- runner 依赖只进 devDependencies；`npm run build` 与 `npm run lint` 必须保持零错误。
- 新增 FE 测试步骤接入 `make preflight`（在后端 pytest 之后追加），保持门禁单命令可用。
- 提交方式：本会话 `git commit` 被已知误报门禁拦截，**一律经 `bash .superpowers/sdd/bin/commit.sh -m "..."` 提交**（先正常 `git add`）。

---

### Task 1: 暗色 FOUC 修复（index.html 内联脚本）

**Files:**
- Modify: `frontend/index.html`（`<head>` 内、`/src/main.tsx` script 之前加一段内联脚本）

**Interfaces:**
- Produces: localStorage `ch-theme=dark` 的用户刷新时首帧即为暗色（`<html>` 初始带 `class="dark"`）；浅色/无偏好用户行为不变。
- 不改 topbar.tsx（其 effect 重复 toggle 同一 class，幂等无害）。

**Steps:**
- [ ] Step 1: index.html `<head>` 末尾加内联脚本：try 读 `localStorage.getItem("ch-theme")`，值等于 `"dark"` 则 `document.documentElement.classList.add("dark")`；任何异常静默
- [ ] Step 2: `npm run build` + `npm run lint` 零错误；`make preflight` 全绿
- [ ] Step 3: 手工验证路径记录到报告（重建容器后带 ch-theme=dark 刷新无闪白；带 light/无值首帧浅色）
- [ ] Step 4: 提交 `fix: 暗色主题首帧闪白（index.html 预置 class）`

---

### Task 2: FE 测试 runner（vitest）+ 首批测试 + preflight 接入

**Files:**
- Modify: `frontend/package.json`（devDeps：vitest、jsdom、@testing-library/react、@testing-library/jest-dom、@testing-library/user-event 可不加——首批用不到就不加；scripts：`"test": "vitest --run"`）
- Create: `frontend/vitest.config.ts`（environment jsdom；setup file 引 @testing-library/jest-dom）
- Create: `frontend/src/test/setup.ts`（jest-dom 扩展）
- Create: `frontend/src/lib/primary-task.ts`（自 App.tsx **逐字移入** `primaryTask` 函数及其依赖的类型导入）
- Modify: `frontend/src/App.tsx`（删除原函数，改 `import { primaryTask } from "@/lib/primary-task"`，调用点不变）
- Create: `frontend/src/lib/primary-task.test.ts`（≥7 断言：master 文本 drafting→定稿、finalized→文本变体、publishing→null；master 图片 drafting/finalized→渲染封面；publish markdown→语音包、video_kit、publishing→登记；topic 四状态→topic_stage；source→null）
- Create: `frontend/src/components/common/attr-summary.test.tsx`（RTL：有 attrs 渲染出尺寸/时长摘要；attrs 缺省渲染 "—"；属性列五类外类型渲染 "—"——以组件实际行为为准，先读组件再写断言）
- Modify: `Makefile`（preflight 追加 `cd frontend && npm test`）

**Interfaces:**
- Produces: `cd frontend && npm test` 可重复执行（--run 非 watch）；`make preflight` 四步全绿（docstd/pytest/alembic/FE 测试）。
- App.tsx 对外行为零变化（同一函数，仅搬家）。

**Steps:**
- [ ] Step 1: `npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom`；建 vitest.config.ts + setup.ts；`npm test` 空跑通过
- [ ] Step 2: primary-task.ts 逐字迁移 + App.tsx 改导入 + primary-task.test.ts；`npm test` 全绿且 `npm run build` 零错误（tsc 对测试文件类型检查通过）
- [ ] Step 3: attr-summary.test.tsx（先读组件实现再定断言）；`npm test` 全绿
- [ ] Step 4: Makefile preflight 追加 FE 步骤；`make preflight` 全绿
- [ ] Step 5: 提交 `feat: 前端 vitest runner 与首批测试接入 preflight`
