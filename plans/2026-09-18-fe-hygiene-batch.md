# 前端卫生小修打包（防抛/可达性/engines/配置/补测）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一揽子清掉两轮评审留档的 5 个小项。全部对走查不可见（除短 ID 单元格的元素语义变化），借现有 FE runner 补测试。

**背景:** 项①来自 hardening 终审发现（topbar 存量缺陷），②③来自列表列改造留档，④⑤来自 FE runner 留档。

## Global Constraints

- 除①④外零行为变化；①的语义仅"localStorage 异常时静默降级浅色"，正常路径读写行为逐字不变。
- ③短 ID 单元格 `<p>` 改 `<button type="button">`：视觉类名原样保留，`stopPropagation` 与复制逻辑原样保留；键盘 Enter/Space 触发由 button 原生语义获得，不写额外键盘处理。
- ④只把 `vitest.config.ts` 加进 `tsconfig.node.json` 的 include；**不改** `import viteConfig from "./vite.config.ts"`（`module: nodenext` 要求显式扩展名，`allowImportingTsExtensions` 已开启——终审留档的原建议按实际配置修正为此法）。
- 测试显式 import vitest；`npm test`、`npm run build`（tsc -b，现覆盖 vitest.config.ts）、`npm run lint` 零错误；`make preflight` 四步全绿。
- 提交一律经 `bash .superpowers/sdd/bin/commit.sh -m "..."`（先 git add）；不用 --no-verify，不理会 SSRF 误报。

---

### Task 1: 五项小修（单任务打包）

**Files:**
- Modify: `frontend/src/components/layout/topbar.tsx`（①初始化 `useState(() => localStorage.getItem(THEME_KEY) === "dark")` 与 effect 内 `setItem` 各包 try/catch，异常静默（读失败视为浅色、写失败跳过记忆）；提取一个模块级小助手或就地 try/catch 均可，以最小改动为准）
- Modify: `frontend/package.json`（②加 `"engines": { "node": ">=22.12" }`——与 vitest 5 engines 对齐；不动 lock）
- Modify: `frontend/src/App.tsx`（③编号列首行 `<p ...>` 改 `<button type="button" ...>`，类名/onClick/title 原样；`</p>` 对应改 `</button>`）
- Modify: `frontend/tsconfig.node.json`（④include 数组加 `"vitest.config.ts"`）
- Modify: `frontend/src/lib/primary-task.test.ts`（⑤补 2 测试：master 图片 `status:"topic"` → `"master_image_drafting"`；publish markdown 非 published 态 → `"publish_markdown"`（状态值从 AssetStatus 联合里选类型合法者；若除 published/publishing 外无合法第三态，则改测 markdown+`"publishing"` 优先于 `"publish_publishing"` 的分支次序，报告里说明选择））

**Interfaces:**
- Produces: `make preflight` 四步全绿且 FE 测试数 23→25；`tsc -b` 类型检查覆盖 vitest.config.ts（构建仍零错误即为证）。

**Steps:**
- [ ] Step 1: 五项逐项实现；`npm test` 全绿（25 个）
- [ ] Step 2: `npm run build` + `npm run lint` 零错误；`make preflight` 全绿
- [ ] Step 3: 提交 `fix: 前端卫生小修打包（topbar防抛/短ID可达/engines/tsconfig覆盖/补测）`
